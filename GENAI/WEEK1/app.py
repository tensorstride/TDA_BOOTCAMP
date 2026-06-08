
"""
DeluluTracks' — Python backend using only the standard library.
No Flask, no external dependencies required.
"""

import os
import re
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

BASE_DIR      = Path(__file__).parent.resolve()
STATIC_DIR    = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

def load_dotenv():
    dotenv_path = BASE_DIR / ".env"
    if dotenv_path.is_file():
        try:
            for line in dotenv_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    os.environ[k] = v
        except Exception as e:
            print(f"Error loading .env file: {e}")

load_dotenv()

DEFAULT_API_KEY = os.environ.get("GEMINI_API_KEY", "")

DEFAULT_KEY_USAGE_COUNT = 0
DEFAULT_KEY_USAGE_LIMIT = 5

GEMINI_MODELS = [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
}

class DeluluTracksHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} — {fmt % args}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path

        if path in ("/", "/index.html"):
            self._serve_file(TEMPLATES_DIR / "index.html")

        elif path.startswith("/static/"):
            self._serve_file(STATIC_DIR / path[len("/static/"):])

        elif path == "/api/youtube":
            params = urllib.parse.parse_qs(parsed.query)
            q = params.get("q", [""])[0].strip() or params.get("query", [""])[0].strip()
            q = urllib.parse.unquote_plus(q)
            if not q:
                return self._send_json({"error": "Missing query param ?q="}, 400)
            vids = get_youtube_video_id(q)
            self._send_json({"videoIds": vids})

        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        global DEFAULT_KEY_USAGE_COUNT
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/search":
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length)
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                return self._send_json({"error": "Invalid JSON"}, 400)

            query   = (body.get("query") or "").strip()
            client_key = (body.get("apiKey") or "").strip()

            if client_key:
                api_key = client_key
            else:
                if DEFAULT_KEY_USAGE_COUNT >= DEFAULT_KEY_USAGE_LIMIT:
                    return self._send_json({
                        "error": "The default Gemini API Key has reached its 5-use limit. Please configure a custom Gemini API Key in the settings."
                    }, 403)
                DEFAULT_KEY_USAGE_COUNT += 1
                api_key = DEFAULT_API_KEY

            if not query:
                return self._send_json({"error": "Query is required"}, 400)
            if not api_key:
                return self._send_json({"error": "Gemini API Key is required"}, 400)

            try:
                result = call_gemini(query, api_key)
                self._send_json(result)
            except Exception as ex:
                self._send_json({"error": str(ex)}, 500)

        elif path == "/api/chat":
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length)
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                return self._send_json({"error": "Invalid JSON"}, 400)

            song = body.get("song")
            message = (body.get("message") or "").strip()
            history = body.get("history") or []
            client_key = (body.get("apiKey") or "").strip()

            if not song or not song.get("title") or not song.get("artist"):
                return self._send_json({"error": "Song details (title and artist) are required"}, 400)
            if not message:
                return self._send_json({"error": "Message is required"}, 400)

            if client_key:
                api_key = client_key
            else:
                if DEFAULT_KEY_USAGE_COUNT >= DEFAULT_KEY_USAGE_LIMIT:
                    return self._send_json({
                        "error": "The default Gemini API Key has reached its 5-use limit. Please configure a custom Gemini API Key in the settings."
                    }, 403)
                DEFAULT_KEY_USAGE_COUNT += 1
                api_key = DEFAULT_API_KEY

            if not api_key:
                return self._send_json({"error": "Gemini API Key is required"}, 400)

            try:
                result = call_gemini_chat(song, message, history, api_key)
                self._send_json(result)
            except Exception as ex:
                self._send_json({"error": str(ex)}, 500)

        else:
            self._send_json({"error": "Not found"}, 404)

    def _serve_file(self, fp: Path):
        try:
            data = fp.read_bytes()
            mime = MIME_TYPES.get(fp.suffix, "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self._send_json({"error": f"File not found: {fp.name}"}, 404)

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def call_gemini(query: str, api_key: str) -> dict:
    prompt = (
        f"You are the music brain of DeluluTracks', a premium AI music app.\n"
        f'The user described: "{query}"\n'
        f'Pick exactly 6 real, well-known songs that perfectly match this feeling or situation.\n'
        f'Mix genres and languages freely (English, Hindi, Tamil, etc.).'
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.85,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "summary": {"type": "STRING"},
                    "songs": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "title":    {"type": "STRING"},
                                "artist":   {"type": "STRING"},
                                "why":      {"type": "STRING"},
                                "yt_query": {"type": "STRING"},
                            },
                            "required": ["title", "artist", "why", "yt_query"]
                        }
                    }
                },
                "required": ["summary", "songs"]
            }
        }
    }

    last_err = "Unknown error"

    for model in GEMINI_MODELS:
        base_url = (
            f"https://generativelanguage.googleapis.com/v1beta/"
            f"models/{model}:generateContent?key={api_key}"
        )

        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    base_url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=30) as res:
                    resp = json.loads(res.read().decode("utf-8"))

                text   = resp["candidates"][0]["content"]["parts"][0]["text"]
                result = json.loads(text.strip())
                print(f"  ✓ {model} responded (attempt {attempt + 1})")
                return result

            except urllib.error.HTTPError as e:
                try:
                    err_body = json.loads(e.read().decode())
                    last_err = err_body.get("error", {}).get("message", str(e))
                except Exception:
                    last_err = f"HTTP {e.code}"

                if e.code in (429, 503):
                    wait = 2 ** attempt
                    print(f"  ⚠ {model} overloaded (attempt {attempt + 1}), retrying in {wait}s…")
                    time.sleep(wait)
                    continue

                if e.code == 404:
                    print(f"  ✗ {model} not available for this key, trying next…")
                    break

                raise RuntimeError(last_err)

            except Exception as ex:
                last_err = str(ex)
                print(f"  ✗ {model} exception: {ex}")
                break

    raise RuntimeError(f"All models failed. Last error: {last_err}")

def call_gemini_chat(song: dict, message: str, history: list, api_key: str) -> dict:
    contents = []
    
    system_context = (
        f"You are the music expert companion for the app DeluluTracks.\n"
        f"The user wants to chat and get more details about the song: '{song['title']}' by '{song['artist']}'.\n"
        f"Answer the user's questions about this song. Provide release year, album/movie it belongs to, "
        f"how popular it is, chart achievements, behind-the-scenes stories, and other interesting trivia.\n"
        f"Keep your responses friendly, extremely engaging, and formatted in clear, concise paragraphs (using markdown bullet points or bold text if helpful). "
        f"Do not write overly long essays. Act as a conversational chat partner."
    )
    
    first_user_turn = True
    for turn in history:
        role = turn.get("role", "user")
        text = turn.get("text", "")
        if role == "user" and first_user_turn:
            text = f"[Context: {system_context}]\n\nUser Question: {text}"
            first_user_turn = False
        contents.append({
            "role": role,
            "parts": [{"text": text}]
        })
        
    current_text = message
    if first_user_turn:
        current_text = f"[Context: {system_context}]\n\nUser Question: {current_text}"
    
    contents.append({
        "role": "user",
        "parts": [{"text": current_text}]
    })
    
    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048
        }
    }
    
    last_err = "Unknown error"
    for model in GEMINI_MODELS:
        base_url = (
            f"https://generativelanguage.googleapis.com/v1beta/"
            f"models/{model}:generateContent?key={api_key}"
        )
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    base_url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=30) as res:
                    resp = json.loads(res.read().decode("utf-8"))
                
                text = resp["candidates"][0]["content"]["parts"][0]["text"]
                print(f"  ✓ {model} chat responded (attempt {attempt + 1})")
                return {"response": text}
            except urllib.error.HTTPError as e:
                try:
                    err_body = json.loads(e.read().decode())
                    last_err = err_body.get("error", {}).get("message", str(e))
                except Exception:
                    last_err = f"HTTP {e.code}"
                if e.code in (429, 503):
                    wait = 2 ** attempt
                    print(f"  ⚠ {model} overloaded in chat (attempt {attempt + 1}), retrying in {wait}s…")
                    time.sleep(wait)
                    continue
                if e.code == 404:
                    print(f"  ✗ {model} chat not available, trying next…")
                    break
                raise RuntimeError(last_err)
            except Exception as ex:
                last_err = str(ex)
                print(f"  ✗ {model} chat exception: {ex}")
                break
    raise RuntimeError(f"All models failed for chat. Last error: {last_err}")

def get_youtube_video_id(query: str):
    try:

        clean_query = query.replace('"', '').replace("'", "").replace('[', '').replace(']', '').replace('(', '').replace(')', '').strip()
        

        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote_plus(clean_query)
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            html = res.read().decode("utf-8", errors="replace")

        matches = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', html)
        if not matches:
            matches = re.findall(r'/watch\?v=([a-zA-Z0-9_-]{11})', html)

        seen = set()
        unique = []
        for vid in matches:
            if vid and vid not in ("undefined",) and vid not in seen:
                seen.add(vid)
                unique.append(vid)
            if len(unique) >= 10:
                break

        print(f"  YouTube '{query}' → {unique[:3]}...")
        return unique
    except Exception as ex:
        print(f"  YouTube lookup error: {ex}")
        return []

if __name__ == "__main__":

    port = int(os.environ.get("PORT", 5001))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    
    print(f"\n🎵  DeluluTracks'  →  http://{host}:{port}\n")
    print("   Open that URL in your browser.")
    print("   Press Ctrl+C to stop.\n")
    server = HTTPServer((host, port), DeluluTracksHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋  Server stopped.")