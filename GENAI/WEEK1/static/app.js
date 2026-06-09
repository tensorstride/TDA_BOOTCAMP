
let tracks = [], cur = -1, ytPlayer = null, ytReady = false, playing = false, ticker = null;
let apiKey = localStorage.getItem('delulu_key') || '';
let apiProvider = localStorage.getItem('delulu_provider') || 'gemini';
let transitioned = false;
let searchHistory = [];
let vidCandidateIndex = 0;  
let isHandlingFailure = false;
let currentTrackChanging = false;  
let searchResults = [];
let savedTracks = JSON.parse(localStorage.getItem('delulu_saved') || '[]');
let activeTab = 'home';
let chatHistory = [];
let chatSong = null;
let chatOpen = false;
let searchLoaderInterval = null;


window.onYouTubeIframeAPIReady = function() {
  ytReady = true;
  ytPlayer = new YT.Player('yt-player', {
    height: '110', width: '180',
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      origin: window.location.origin
    },
    events: { onStateChange: onYTState, onError: onYTError }
  });
};

function onYTState(e) {
  const S = YT.PlayerState;
  if (e.data === S.PLAYING) {
    isHandlingFailure = false;
    currentTrackChanging = false;
    playing = true;
    syncPP();
    startTick();
    updateNowPlayBtn(true);
  }
  if (e.data === S.PAUSED) {
    playing = false;
    syncPP();
    clearInterval(ticker);
    updateNowPlayBtn(false);
  }
  if (e.data === S.ENDED) {
    next();
  }
}

function onYTError(event) {
  console.warn("YouTube Player encountered an event code:", event.data);
  
  
  if (event.data === 101 || event.data === 150 || event.data === 100) {
    console.error("Critical embedding restriction. Activating alternative search track...");
    handlePlaybackFailure();
  } else {
    
    console.log("Non-critical stream hiccup. Attempting to force-start stream buffer...");
    try {
      ytPlayer.playVideo();
    } catch (err) {
      console.error("Failed to force-start stream:", err);
    }
  }
}

function handlePlaybackFailure() {
  if (isHandlingFailure) return;
  isHandlingFailure = true;

  const t = tracks[cur];
  if (!t) return;

  vidCandidateIndex++;
  const candidates = t._videoIds || [];

  if (vidCandidateIndex < candidates.length) {
    
    const nextVid = candidates[vidCandidateIndex];
    console.log(`Trying candidate ${vidCandidateIndex}: ${nextVid}`);
    toast(`Trying alternative for "${t.title}"...`);
    setTimeout(() => {
      isHandlingFailure = false;
      loadAndPlay(nextVid);
    }, 600);
  } else {
    
    toast(`"${t.title}" is blocked on YouTube. Removing...`);
    const failedIdx = cur;
    setTimeout(() => {
      isHandlingFailure = false;
      removeFailedTrack(failedIdx);
    }, 1800);
  }
}

(function(){
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();

function fill(text) {
  document.getElementById('qInput').value = text;
  go();
}

function openModal()  {
  document.getElementById('modalBg').classList.add('open');
  selectProvider(apiProvider);
  document.getElementById('apiKeyInput').value = apiKey;
  document.getElementById('apiKeyInput').focus();
}
function closeModal() { document.getElementById('modalBg').classList.remove('open'); }
function openHelpModal() {
  document.getElementById('helpModalBg').classList.add('open');
  showHelpTab(apiProvider);
}
function closeHelpModal() { document.getElementById('helpModalBg').classList.remove('open'); }

function selectProvider(p) {
  apiProvider = p;
  const geminiBtn = document.getElementById('providerGemini');
  const groqBtn = document.getElementById('providerGroq');
  if (geminiBtn) geminiBtn.classList.toggle('active', p === 'gemini');
  if (groqBtn) groqBtn.classList.toggle('active', p === 'groq');
  
  const labelEl = document.getElementById('apiKeyLabel');
  const inputEl = document.getElementById('apiKeyInput');
  if (p === 'gemini') {
    if (labelEl) labelEl.textContent = 'Gemini API Key';
    if (inputEl) inputEl.placeholder = 'AIza...';
  } else {
    if (labelEl) labelEl.textContent = 'Groq API Key';
    if (inputEl) inputEl.placeholder = 'gsk_...';
  }
}

function showHelpTab(p) {
  const geminiHelpTab = document.getElementById('tabHelpGemini');
  const groqHelpTab = document.getElementById('tabHelpGroq');
  if (geminiHelpTab) geminiHelpTab.classList.toggle('active', p === 'gemini');
  if (groqHelpTab) groqHelpTab.classList.toggle('active', p === 'groq');
  
  const geminiContent = document.getElementById('helpContentGemini');
  const groqContent = document.getElementById('helpContentGroq');
  if (geminiContent) geminiContent.style.display = p === 'gemini' ? 'block' : 'none';
  if (groqContent) groqContent.style.display = p === 'groq' ? 'block' : 'none';
}

function saveKey() {
  const k = document.getElementById('apiKeyInput').value.trim();
  if (!k) { toast('Please enter a key'); return; }
  apiKey = k;
  localStorage.setItem('delulu_key', k);
  localStorage.setItem('delulu_provider', apiProvider);
  closeModal();
  toast(`${apiProvider === 'gemini' ? 'Gemini' : 'Groq'} key saved ✓`);
}

function doTransition() {
  if (transitioned) return;
  transitioned = true;

  const hero       = document.getElementById('hero');
  const sw         = document.getElementById('searchWrap');
  const topbar     = document.getElementById('topbar');
  const topbarInner= document.getElementById('topbarInner');

  const r1 = sw.getBoundingClientRect();

  topbarInner.insertBefore(sw, topbarInner.firstChild);
  topbar.classList.add('visible');

  const r2 = sw.getBoundingClientRect();

  const dx = r1.left - r2.left;
  const dy = r1.top  - r2.top;
  const sx = r1.width  / r2.width;
  const sy = r1.height / r2.height;

  sw.style.transition    = 'none';
  sw.style.transformOrigin = 'top left';
  sw.style.transform     = `translate(${dx}px,${dy}px) scale(${sx},${sy})`;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    sw.style.transition  = 'transform 0.65s cubic-bezier(0.16,1,0.3,1)';
    sw.style.transform   = 'translate(0,0) scale(1)';
  }));

  hero.classList.add('gone');
}

async function go() {
  const q = document.getElementById('qInput').value.trim();
  if (!q) { toast('Describe a feeling or situation first'); return; }

  doTransition();

  const box = document.getElementById('qInput');
  const btn = document.getElementById('goBtn');
  box.classList.add('pulsing');
  btn.classList.add('spin');
  btn.disabled = true;

  // Clear any active search loading animations or timers
  clearInterval(searchLoaderInterval);

  // Switch to home tab and hide results/saved panels to show the loading screen
  showTab('home');
  const rp = document.getElementById('resultsPane');
  if (rp) {
    rp.style.display = 'none';
    rp.classList.remove('in');
  }
  const sp = document.getElementById('savedPane');
  if (sp) {
    sp.style.display = 'none';
    sp.classList.remove('in');
  }

  // Show the loader overlay
  const loadingEl = document.getElementById('searchLoading');
  if (loadingEl) {
    loadingEl.style.display = 'flex';
  }

  // Set up subtitle phrase rotation
  const loaderPhrases = [
    "Consulting the Gemini music brain...",
    "Analyzing emotional frequencies...",
    "Scanning the global sound archives...",
    "Mapping your feelings to acoustic matches...",
    "Synthesizing perfect playlists...",
    "Decoding sonic aesthetics...",
    "Discovering hidden musical gems..."
  ];
  let phraseIdx = 0;
  const subtitleEl = document.getElementById('searchLoaderSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = "Curating tracks that match your exact vibe...";
    subtitleEl.style.opacity = '1';
  }

  searchLoaderInterval = setInterval(() => {
    if (subtitleEl) {
      subtitleEl.style.opacity = '0';
      setTimeout(() => {
        phraseIdx = (phraseIdx + 1) % loaderPhrases.length;
        subtitleEl.textContent = loaderPhrases[phraseIdx];
        subtitleEl.style.opacity = '1';
      }, 300);
    }
  }, 2200);

  try {
    const data = await callBackend(q);
    tracks = data.songs || [];
    searchResults = [...tracks];
    if (!tracks.length) throw new Error('No songs returned');

    if (!searchHistory.includes(q)) {
      searchHistory.unshift(q);
      if (searchHistory.length > 8) searchHistory.pop();
      renderHistory();
    }

    renderResults(q, data.summary);

    prefetchAllTracks().then(() => {
      renderQueueOnly();  
    });

    playAt(0);

  } catch(err) {
    toast('Error: ' + err.message);
    if (err.message.includes('API Key')) openModal();
    // Restore previous search results view if we have any
    if (searchResults && searchResults.length > 0 && rp) {
      rp.style.display = 'block';
      requestAnimationFrame(() => rp.classList.add('in'));
    }
  } finally {
    box.classList.remove('pulsing');
    btn.classList.remove('spin');
    btn.disabled = false;
    
    // Hide the loader and stop subtitle rotation
    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
    clearInterval(searchLoaderInterval);
  }
}

async function prefetchAllTracks() {
  await Promise.all(tracks.map(async (t, i) => {
    if (t._videoIds && t._videoIds.length) return;  
    const query = t.yt_query || `${t.title} ${t.artist} official audio`;
    const ids = await getVideoIds(query);
    t._videoIds = ids;
    if (ids.length > 0) {
      t._thumb   = `https://img.youtube.com/vi/${ids[0]}/mqdefault.jpg`;
      t._thumbSq = `https://img.youtube.com/vi/${ids[0]}/default.jpg`;
      
      const ta = document.getElementById(`ta${i}`);
      if (ta) ta.innerHTML = `<img src="${t._thumbSq}" alt="">`;
    }
  }));
}

async function callBackend(q) {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, apiKey: apiKey, apiProvider: apiProvider })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

function renderResults(q, summary) {
  document.getElementById('rqTitle').textContent = `"${q}"`;
  document.getElementById('rqSub').textContent   = summary || '';
  renderQueueOnly();
  const rp = document.getElementById('resultsPane');
  rp.style.display = 'block';
  requestAnimationFrame(() => rp.classList.add('in'));
}

function renderQueueOnly() {
  if (tracks.length === 0) {
    document.getElementById('queueList').innerHTML = '';
    return;
  }

  setNowCard(tracks[0], cur === 0 && playing);

  document.getElementById('queueList').innerHTML = tracks.slice(1).map((t, i) => {
    const idx = i + 1;
    const thumbHtml = t._thumbSq ? `<img src="${t._thumbSq}" alt="">` : '♪';
    const isFav = isSaved(t);
    const favClass = isFav ? 'tr-fav saved' : 'tr-fav';
    const favIcon = isFav 
      ? `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
      : `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>`;

    return `
    <div class="track-row" id="tr${idx}" onclick="playAt(${idx})">
      <div class="tr-num">
        <span class="tr-num-txt">${idx + 1}</span>
        <div class="tr-bars"><div class="tr-bar"></div><div class="tr-bar"></div><div class="tr-bar"></div></div>
      </div>
      <div class="tr-art" id="ta${idx}">${thumbHtml}</div>
      <div class="tr-info">
        <div class="tr-name">${escHtml(t.title)}</div>
        <div class="tr-artist">${escHtml(t.artist)}</div>
      </div>
      <div class="tr-why">${escHtml(t.why)}</div>
      <div class="tr-chat" onclick="event.stopPropagation(); openChatForTrack(${idx})" title="Chat about this song">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      </div>
      <div class="${favClass}" onclick="event.stopPropagation(); toggleFav(${idx}, event)">${favIcon}</div>
      <div class="tr-dur" id="td${idx}">—:——</div>
    </div>`;
  }).join('');

  updateActiveRow(cur);
}

function removeFailedTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  tracks.splice(index, 1);
  
  if (activeTab === 'home') {
    searchResults = [...tracks];
    renderQueueOnly();
  } else {
    savedTracks = [...tracks];
    localStorage.setItem('delulu_saved', JSON.stringify(savedTracks));
    renderSavedList();
  }

  if (cur === index) {
    if (tracks.length > 0) {
      if (cur >= tracks.length) cur = 0;
      playAt(cur);
    } else {
      cur = -1;
      playing = false;
      syncPP();
      document.getElementById('plName').textContent    = '—';
      document.getElementById('plArtist').textContent  = '—';
      document.getElementById('nowTitle').textContent  = '—';
      document.getElementById('nowArtist').textContent = '—';
      document.getElementById('nowInsight').textContent = '—';
      document.getElementById('nowArt').innerHTML = '♪';
      document.getElementById('plArt').innerHTML  = '♪';
    }
  } else if (cur > index) {
    cur--;
    updateActiveRow(cur);
  }
}

function setNowCard(t, isPlaying) {
  if (!t) return;
  document.getElementById('nowTitle').textContent   = t.title;
  document.getElementById('nowArtist').textContent  = t.artist;
  document.getElementById('nowInsight').textContent = t.why;
  document.getElementById('nowArt').innerHTML = t._thumb
    ? `<img src="${t._thumb}" alt="">` : '♪';
  updateNowPlayBtn(isPlaying);

  const nowFavBtn = document.getElementById('nowFavBtn');
  if (nowFavBtn) {
    const isFav = isSaved(t);
    nowFavBtn.classList.toggle('saved', isFav);
    nowFavBtn.innerHTML = isFav
      ? `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
      : `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>`;
  }
}

function updateNowPlayBtn(isPlaying) {
  document.getElementById('nowPlayBtn').innerHTML = isPlaying
    ? `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}

function renderHistory() {
  document.getElementById('histList').innerHTML =
    searchHistory.map(h =>
      `<div class="hist-item" onclick="fill(${JSON.stringify(h)})">↳ ${escHtml(h)}</div>`
    ).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── playback
async function playAt(i) {
  if (i < 0 || i >= tracks.length) return;
  if (!ytReady || !ytPlayer) { toast('Player still loading, try again in a second'); return; }
  if (currentTrackChanging) return;
  currentTrackChanging = true;

  cur = i;
  vidCandidateIndex = 0;
  isHandlingFailure = false;

  updateActiveRow(i);

  const t = tracks[i];
  setNowCard(t, false);
  document.getElementById('plName').textContent   = t.title;
  document.getElementById('plArtist').textContent = t.artist;
  
  const playerChatBtn = document.getElementById('playerChatBtn');
  if (playerChatBtn) playerChatBtn.style.display = 'flex';
  document.getElementById('pFill').style.width = '0%';
  document.getElementById('ct').textContent = '0:00';
  document.getElementById('tt').textContent = '—:——';

  toast(`Loading "${t.title}"...`);

  // Ensure we have video IDs for this track
  if (!t._videoIds || !t._videoIds.length) {
    const query = t.yt_query || `${t.title} ${t.artist} official audio`;
    t._videoIds = await getVideoIds(query);
    if (t._videoIds.length > 0) {
      t._thumb   = `https://img.youtube.com/vi/${t._videoIds[0]}/mqdefault.jpg`;
      t._thumbSq = `https://img.youtube.com/vi/${t._videoIds[0]}/default.jpg`;
      setNowCard(t, false);
      const ta = document.getElementById(`ta${i}`);
      if (ta) ta.innerHTML = `<img src="${t._thumbSq}" alt="">`;
    }
  }

  if (!t._videoIds || !t._videoIds.length) {
    currentTrackChanging = false;
    toast(`No YouTube results for "${t.title}". Removing...`);
    setTimeout(() => removeFailedTrack(i), 1800);
    return;
  }

  if (t._thumbSq) {
    document.getElementById('plArt').innerHTML = `<img src="${t._thumbSq}" alt="">`;
  }

  // Release the lock after half a second to guarantee smooth streaming transitions
  setTimeout(() => {
    currentTrackChanging = false;
  }, 500);
  loadAndPlay(t._videoIds[0]);
}

let playbackTimeout = null;

function loadAndPlay(vid) {
  if (!tracks[cur]) return;

  // Reveal the sidebar video player when a song starts
  const ytContainer = document.getElementById('ytContainer');
  if (ytContainer) ytContainer.style.display = 'flex';

  // Clear any pending state transitions to prevent rapid-click crashes
  if (playbackTimeout) clearTimeout(playbackTimeout);

  // Stop current stream immediately to reset the iframe buffer
  try {
    ytPlayer.stopVideo();
  } catch (e) {
    console.log("Resetting player buffer...");
  }

  // Give the iframe 150ms to clear its internal state before feeding the new ID
  playbackTimeout = setTimeout(() => {
    try {
      ytPlayer.loadVideoById({
        videoId: vid,
        suggestedQuality: 'default'
      });
      ytPlayer.playVideo();
      ytPlayer.setVolume(parseInt(document.getElementById('volSl').value, 10));
      console.log(`Successfully streaming video: ${vid}`);
    } catch (error) {
      console.error("Playback initialization failed, retrying...", error);
      // Fallback: reload the iframe source directly if the API pipeline freezes
      const iframe = document.getElementById('yt-player');
      if (iframe) {
        iframe.src = `https://www.youtube.com/embed/${vid}?enablejsapi=1&autoplay=1`;
      }
    }
  }, 150);

  hideToast();
}

function updateActiveRow(i) {
  document.getElementById('nowCard').classList.toggle('on', i === 0);
  document.querySelectorAll('.track-row').forEach((el, j) => {
    el.classList.toggle('on', j + 1 === i);
  });
}

async function getVideoIds(query) {
  try {
    const res  = await fetch('/api/youtube?q=' + encodeURIComponent(query));
    const data = await res.json();
    return data.videoIds || [];
  } catch { return []; }
}

// ── player controls
function toggle() {
  if (!ytPlayer || cur < 0) return;
  playing ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
}

function next() {
  const nextIdx = cur + 1 < tracks.length ? cur + 1 : 0;
  playAt(nextIdx);
}

function prev() {
  const elapsed = ytPlayer?.getCurrentTime?.() || 0;
  if (elapsed > 3) {
    ytPlayer.seekTo(0, true);
  } else {
    playAt(cur > 0 ? cur - 1 : tracks.length - 1);
  }
}

function syncPP() {
  document.getElementById('pIcon').style.display     = playing ? 'none'  : 'block';
  document.getElementById('pauseIcon').style.display = playing ? 'block' : 'none';
}

function startTick() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (!ytPlayer?.getCurrentTime) return;
    const c = ytPlayer.getCurrentTime() || 0;
    const d = ytPlayer.getDuration()    || 0;
    if (d > 0) document.getElementById('pFill').style.width = (c / d * 100) + '%';
    document.getElementById('ct').textContent = fmt(c);
    document.getElementById('tt').textContent = fmt(d);
  }, 500);
}

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function seek(e) {
  if (!ytPlayer?.getDuration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = (e.clientX - rect.left) / rect.width;
  ytPlayer.seekTo(ytPlayer.getDuration() * pct, true);
}

function setVol(v) {
  if (ytPlayer?.setVolume) ytPlayer.setVolume(parseInt(v, 10));
}

// ── toast
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3500);
}
function hideToast() {
  document.getElementById('toast').classList.remove('on');
}

// ── Saved & Navigation Helpers
function isSaved(t) {
  if (!t) return false;
  return savedTracks.some(st => st.title === t.title && st.artist === t.artist);
}

function toggleFav(idx, event) {
  const t = tracks[idx];
  if (!t) return;
  
  const savedIdx = savedTracks.findIndex(st => st.title === t.title && st.artist === t.artist);
  if (savedIdx > -1) {
    savedTracks.splice(savedIdx, 1);
    toast(`Removed "${t.title}" from Saved`);
  } else {
    savedTracks.push(t);
    toast(`Saved "${t.title}" to library`);
  }
  
  localStorage.setItem('delulu_saved', JSON.stringify(savedTracks));
  updateFavStates();
}

function updateFavStates() {
  const nowFavBtn = document.getElementById('nowFavBtn');
  if (nowFavBtn && tracks[cur]) {
    const isFav = isSaved(tracks[cur]);
    nowFavBtn.classList.toggle('saved', isFav);
    nowFavBtn.innerHTML = isFav
      ? `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
      : `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>`;
  }

  if (activeTab === 'home') {
    renderQueueOnly();
  } else if (activeTab === 'saved') {
    tracks = [...savedTracks];
    renderSavedList();
  }
}

function goHome() {
  document.getElementById('qInput').value = '';
  showTab('home', true);
}

function resetTransition() {
  if (!transitioned) return;

  const hero       = document.getElementById('hero');
  const sw         = document.getElementById('searchWrap');
  const topbar     = document.getElementById('topbar');

  // 1. Measure the current position in the topbar (compact state)
  const r1 = sw.getBoundingClientRect();

  // 2. Put the searchWrap element back into the hero landing view, above preset chips
  const chips = hero.querySelector('.chips');
  if (chips) {
    hero.insertBefore(sw, chips);
  } else {
    hero.appendChild(sw);
  }

  // 3. Make the landing page visible again and hide the topbar
  hero.classList.remove('gone');
  topbar.classList.remove('visible');

  // 4. Measure the target centered position in the hero
  const r2 = sw.getBoundingClientRect();

  // 5. Calculate coordinate delta for the transition
  const dx = r1.left - r2.left;
  const dy = r1.top  - r2.top;
  const sx = r1.width  / r2.width;
  const sy = r1.height / r2.height;

  // 6. Reset elements directly to the layout starting position
  sw.style.transition    = 'none';
  sw.style.transformOrigin = 'top left';
  sw.style.transform     = `translate(${dx}px,${dy}px) scale(${sx},${sy})`;

  // 7. Update state variables
  transitioned = false;

  // 8. Animate the searchWrap back to its clean centered layout
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sw.style.transition  = 'transform 0.65s cubic-bezier(0.16,1,0.3,1)';
    sw.style.transform     = 'translate(0,0) scale(1)';
  }));
}

function showTab(tabName, forceReset = false) {
  activeTab = tabName;
  
  const navHome = document.getElementById('navHome');
  const navSaved = document.getElementById('navSaved');
  const resultsPane = document.getElementById('resultsPane');
  const savedPane = document.getElementById('savedPane');
  const hero = document.getElementById('hero');

  if (tabName === 'home') {
    navHome.classList.add('on');
    navSaved.classList.remove('on');
    savedPane.style.display = 'none';
    savedPane.classList.remove('in');
    
    if (forceReset) {
      resetTransition();
      resultsPane.style.display = 'none';
      resultsPane.classList.remove('in');
      hero.classList.remove('gone');
    } else {
      if (transitioned) {
        resultsPane.style.display = 'block';
        resultsPane.classList.add('in');
        hero.classList.add('gone');
        tracks = [...searchResults];
      } else {
        resultsPane.style.display = 'none';
        resultsPane.classList.remove('in');
        hero.classList.remove('gone');
      }
    }
  } else if (tabName === 'saved') {
    navHome.classList.remove('on');
    navSaved.classList.add('on');
    resultsPane.style.display = 'none';
    resultsPane.classList.remove('in');
    hero.classList.add('gone');
    
    savedPane.style.display = 'block';
    requestAnimationFrame(() => savedPane.classList.add('in'));
    
    tracks = [...savedTracks];
    renderSavedList();
  }
}


function renderSavedList() {
  const savedListEmpty = document.getElementById('savedListEmpty');
  const savedQueue = document.getElementById('savedQueue');
  const savedList = document.getElementById('savedList');

  if (savedTracks.length === 0) {
    savedListEmpty.style.display = 'flex';
    savedQueue.style.display = 'none';
    savedList.innerHTML = '';
    return;
  }

  savedListEmpty.style.display = 'none';
  savedQueue.style.display = 'block';

  savedList.innerHTML = savedTracks.map((t, i) => {
    const thumbHtml = t._thumbSq ? `<img src="${t._thumbSq}" alt="">` : '♪';
    const isFav = true;
    const favClass = 'tr-fav saved';
    const favIcon = `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    
    const isOn = (cur === i && tracks === savedTracks);
    const rowClass = isOn ? 'track-row on' : 'track-row';
    const barsHtml = isOn ? '<div class="tr-bars"><div class="tr-bar"></div><div class="tr-bar"></div><div class="tr-bar"></div></div>' : '';

    return `
    <div class="${rowClass}" onclick="playSavedAt(${i})">
      <div class="tr-num">
        <span class="tr-num-txt">${i + 1}</span>
        ${barsHtml}
      </div>
      <div class="tr-art">${thumbHtml}</div>
      <div class="tr-info">
        <div class="tr-name">${escHtml(t.title)}</div>
        <div class="tr-artist">${escHtml(t.artist)}</div>
      </div>
      <div class="tr-why">${escHtml(t.why)}</div>
      <div class="tr-chat" onclick="event.stopPropagation(); openChatForTrack(${i})" title="Chat about this song">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      </div>
      <div class="${favClass}" onclick="event.stopPropagation(); toggleFav(${i}, event)">${favIcon}</div>
      <div class="tr-dur">—:——</div>
    </div>`;
  }).join('');
}

function playSavedAt(i) {
  tracks = [...savedTracks];
  playAt(i);
}

function toggleChat() {
  if (chatOpen) {
    closeChat();
  } else {
    if (cur > -1 && tracks[cur]) {
      openChatForTrack(cur);
    } else {
      toast("Play or select a song first to chat!");
    }
  }
}

function closeChat() {
  chatOpen = false;
  document.getElementById('chatDrawer').classList.remove('open');
}

async function openChatForTrack(index) {
  const song = tracks[index];
  if (!song) return;

  chatSong = song;
  chatOpen = true;

  document.getElementById('chatSongTitle').textContent = song.title;
  document.getElementById('chatSongArtist').textContent = song.artist;
  document.getElementById('chatDrawer').classList.add('open');

  const welcomeText = `Hey! I'm your DeluluTracks companion. Ask me anything about **${song.title}** by **${song.artist}**! You can ask about its release year, movie/album details, popularity, or interesting trivia.`;
  chatHistory = [
    { role: 'model', text: welcomeText }
  ];
  renderChatMessages();
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg || !chatSong) return;

  input.value = '';
  
  chatHistory.push({ role: 'user', text: msg });
  renderChatMessages();

  const messagesDiv = document.getElementById('chatMessages');
  const loader = document.createElement('div');
  loader.className = 'chat-msg ai temp-loader';
  
  const phrases = [
    "Consulting the music brain...",
    "Digging up background details...",
    "Checking the charts...",
    "Decoding the lyrics...",
    "Uncovering song secrets..."
  ];
  const chosenPhrase = phrases[Math.floor(Math.random() * phrases.length)];
  
  loader.innerHTML = `
    <div class="chat-loader-content">
      <div class="chat-loader-text">${chosenPhrase}</div>
      <div class="chat-loader-bar"><div class="chat-loader-progress"></div></div>
    </div>
  `;
  messagesDiv.appendChild(loader);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    const historyToSend = chatHistory.slice(1, -1);
    const data = await callChatAPI(chatSong, msg, historyToSend);
    
    const tempLoader = messagesDiv.querySelector('.temp-loader');
    if (tempLoader) tempLoader.remove();

    chatHistory.push({ role: 'model', text: data.response });
    renderChatMessages();
  } catch (err) {
    const tempLoader = messagesDiv.querySelector('.temp-loader');
    if (tempLoader) tempLoader.remove();

    toast(`Error: ${err.message}`);
    if (err.message.includes('API Key')) openModal();
  }
}

async function callChatAPI(song, message, history) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      song: { title: song.title, artist: song.artist },
      message: message,
      history: history,
      apiKey: apiKey,
      apiProvider: apiProvider
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

function renderChatMessages() {
  const messagesDiv = document.getElementById('chatMessages');
  messagesDiv.innerHTML = chatHistory.map(m => {
    const isUser = m.role === 'user';
    let text = m.text;
    if (text.includes('[Context:')) {
      text = text.split('\n\nUser Question: ').slice(1).join('\n\nUser Question: ');
    }
    
    const formatted = formatMarkdown(text);
    return `<div class="chat-msg ${isUser ? 'user' : 'ai'}">${formatted}</div>`;
  }).join('');
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function formatMarkdown(text) {
  let html = escHtml(text);
  
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  const lines = html.split('\n');
  let inList = false;
  const processed = [];
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      if (!inList) {
        processed.push('<ul>');
        inList = true;
      }
      processed.push(`<li>${trimmed.substring(2)}</li>`);
    } else {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      processed.push(`<p>${line}</p>`);
    }
  }
  if (inList) {
    processed.push('</ul>');
  }
  return processed.join('');
}
