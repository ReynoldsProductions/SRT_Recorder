// C2C Console front end: polls the console API and renders inputs + recordings.
// All dynamic values are written with textContent (no HTML injection).

import { createPreview } from './preview-player.js';
import { createInputsAdmin } from './inputs-admin.js';

const POLL_MS = 2000;
const RECORDINGS_POLL_MS = 10000;
const $ = (sel, root = document) => root.querySelector(sel);
const pending = new Set(); // inputs with an in-flight start/stop request
const previews = new Map(); // input name -> { player, wanted }
let currentShoot = '';

// --- formatting -----------------------------------------------------------
const fmtBitrate = (bps) => (bps ? `${(bps / 1e6).toFixed(1)} Mbps` : '—');
const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${hh}:${mm}:${String(s % 60).padStart(2, '0')}`;
}
const since = (iso) => (iso ? fmtDuration(Date.now() - Date.parse(iso)) : '—');
const fmtLocal = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtTake = (n) => `T${String(n).padStart(3, '0')}`;

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. */ }
  },
};

// --- API ------------------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-C2C-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  if (!payload.success) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload.data;
}

function showBanner(msg, kind = 'error') {
  const el = $('#banner');
  el.textContent = msg ?? '';
  el.className = `banner ${kind}`;
  el.hidden = !msg;
}

function setConn(ok) {
  const el = $('#conn');
  el.textContent = ok ? 'connected' : 'console unreachable';
  el.className = `pill ${ok ? 'ok' : 'err'}`;
}

const admin = createInputsAdmin({ api, showBanner, onChange: () => refreshInputs() });

// --- shoot & all ------------------------------------------------------------
function applyState(state) {
  currentShoot = state.shoot;
  const field = $('#shoot-name');
  if (document.activeElement !== field) field.value = state.shoot;
  $('#save-root').textContent = `saving to <recordings>/${state.shoot}/<input>/`;
  if (state.recordingsShare) {
    $('#share-url').textContent = state.recordingsShare;
    $('#share-line').hidden = false;
  }
}

$('#shoot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#shoot-name').value.trim();
  if (!name) return;
  if (!confirm(`Start new shoot "${name}"?\n\nNew recordings go to <recordings>/<shoot>/<input>/ and the recordings list is cleared (files are kept).`)) return;
  try {
    applyState(await api('/api/shoot', { method: 'POST', body: { shoot: name } }));
    showBanner(null);
    refreshInputs();
    refreshRecordings();
  } catch (err) {
    showBanner(`New shoot failed: ${err.message}`);
  }
});

function summarizeAll(results, verb) {
  const lines = results.map((r) => `${r.input}: ${r.ok ? (r.skipped ?? `${verb} ${r.outputFilePath ?? ''}`) : r.error}`);
  const failed = results.some((r) => !r.ok);
  showBanner(lines.join(' · '), failed ? 'error' : 'info');
}

$('#start-all').addEventListener('click', async () => {
  try {
    summarizeAll(await api('/api/record/start-all', { method: 'POST' }), 'recording');
  } catch (err) {
    showBanner(`Start all failed: ${err.message}`);
  }
  refreshInputs();
});

$('#stop-all').addEventListener('click', async () => {
  if (!confirm('Stop recording on ALL inputs?')) return;
  try {
    summarizeAll(await api('/api/record/stop-all', { method: 'POST' }), 'stopped');
  } catch (err) {
    showBanner(`Stop all failed: ${err.message}`);
  }
  refreshInputs();
  setTimeout(refreshRecordings, 1500);
});

// --- input cards ----------------------------------------------------------
function setupPreview(card, name) {
  const video = $('video', card);
  const status = $('.preview-status', card);
  const player = createPreview(video, name, { onStatus: (s) => { status.textContent = s; } });
  const entry = { player, wanted: store.get(`preview:${name}`) !== 'off' };
  previews.set(name, entry);

  const toggle = $('.preview-toggle', card);
  const syncToggle = () => { toggle.textContent = entry.wanted ? 'Preview off' : 'Preview on'; };
  syncToggle();
  toggle.addEventListener('click', () => {
    entry.wanted = !entry.wanted;
    store.set(`preview:${name}`, entry.wanted ? 'on' : 'off');
    syncToggle();
    if (!entry.wanted) player.stop();
    else if (card.dataset.signal === 'live') player.play();
  });
  const audio = $('.preview-audio', card);
  audio.addEventListener('click', () => {
    video.muted = !video.muted;
    audio.textContent = video.muted ? '🔇' : '🔊';
  });
  video.addEventListener('click', () => video.play().catch(() => {}));
}

async function saveClip(card) {
  const name = card.dataset.input;
  const field = $('.clip-name', card);
  if (!field.value.trim() || field.value === card.dataset.savedClip) return;
  try {
    const { clip } = await api(`/api/inputs/${encodeURIComponent(name)}/clip`, { method: 'POST', body: { clip: field.value } });
    card.dataset.savedClip = clip;
    field.value = clip;
    showBanner(null);
    refreshInputs();
  } catch (err) {
    showBanner(`${name}: ${err.message}`);
  }
}

function cardFor(name) {
  let card = document.querySelector(`[data-input="${CSS.escape(name)}"]`);
  if (card) return card;
  card = $('#input-card').content.firstElementChild.cloneNode(true);
  card.dataset.input = name;
  const clip = $('.clip-name', card);
  clip.addEventListener('change', () => saveClip(card));
  clip.addEventListener('keydown', (e) => { if (e.key === 'Enter') clip.blur(); });
  $('.take-reset', card).addEventListener('click', async () => {
    try {
      await api(`/api/inputs/${encodeURIComponent(name)}/take`, { method: 'POST', body: { next: 1 } });
      refreshInputs();
    } catch (err) {
      showBanner(`${name}: ${err.message}`);
    }
  });
  $('.rec-btn', card).addEventListener('click', () => toggleRecording(card));
  $('#inputs').append(card);
  setupPreview(card, name);
  admin.bindCard(card, name);
  return card;
}

function removeStaleCards(names) {
  document.querySelectorAll('#inputs .card').forEach((card) => {
    if (names.has(card.dataset.input)) return;
    previews.get(card.dataset.input)?.player.stop();
    previews.delete(card.dataset.input);
    card.remove();
  });
}

const SIGNAL_LABEL = { live: 'Signal', stalled: 'Stalled', none: 'No signal', unknown: 'Unknown' };
const RELAY_LABEL = { waiting: 'Relay listening — waiting for camera', connected: 'Camera connected to relay', stopped: 'Relay stopped', disabled: 'Input disabled', unknown: 'Relay status unknown' };

function syncPreview(name, signal) {
  const entry = previews.get(name);
  if (!entry) return;
  if (signal === 'live' && entry.wanted && !entry.player.active) entry.player.play();
  if (signal === 'none' && entry.player.active) entry.player.stop();
}

function renderInput(input) {
  const card = cardFor(input.name);
  const rec = input.recording;
  card.className = `card ${input.signal}${rec ? ' recording' : ''}${input.enabled === false ? ' disabled' : ''}`;
  card.dataset.recording = rec ? '1' : '';
  card.dataset.signal = input.signal;
  $('.name', card).textContent = input.name;
  $('.label', card).textContent = `${input.label ? `${input.label} · ` : ''}udp/${input.port}`;
  const sig = $('.signal', card);
  sig.textContent = SIGNAL_LABEL[input.signal] ?? input.signal;
  sig.className = `signal pill ${input.signal}`;
  const relay = input.relay ?? { state: 'unknown' };
  $('.relay', card).textContent = `${RELAY_LABEL[relay.state] ?? relay.state}${relay.lastError ? ` · last error: ${relay.lastError}` : ''}`;

  const v = input.video;
  $('.video', card).textContent = v ? `${v.codec} ${v.width}×${v.height} @ ${v.fps}` : '—';
  const a = input.audio;
  $('.audio', card).textContent = a ? `${a.codec} ${a.channels}ch ${a.sampleRate / 1000} kHz` : '—';
  $('.bitrate', card).textContent = fmtBitrate(input.bitrateBps);
  $('.uptime', card).textContent = input.signal === 'none' ? '—' : since(input.connectedSince);

  const clipField = $('.clip-name', card);
  card.dataset.savedClip = input.clip;
  if (document.activeElement !== clipField) clipField.value = input.clip === 'untitled' ? '' : input.clip;
  clipField.disabled = Boolean(rec);
  $('.take', card).textContent = rec ? `Recording ${fmtTake(input.recording.take ?? input.nextTake - 1)}` : `Next: ${fmtTake(input.nextTake)}`;
  $('.take-reset', card).disabled = Boolean(rec) || input.nextTake === 1;
  $('.dest', card).textContent = `→ ${rec ? rec.outputFilePath ?? rec.id : input.nextFile}`;
  $('.rec-text', card).textContent = rec ? `REC ${fmtDuration(rec.elapsedMs)}` : 'Not recording';
  $('.rec-detail', card).textContent = rec ? `${fmtBytes(rec.recordBytes)} · ${rec.state}` : '';

  const btn = $('.rec-btn', card);
  btn.textContent = rec ? '■ Stop recording' : '● Start recording';
  btn.classList.toggle('stop', Boolean(rec));
  btn.disabled = pending.has(input.name) || (!rec && input.signal !== 'live');
  admin.renderSetup(card);
  syncPreview(input.name, input.signal);
}

async function toggleRecording(card) {
  const name = card.dataset.input;
  const recording = card.dataset.recording === '1';
  if (recording && !confirm(`Stop recording on ${name}?`)) return;
  pending.add(name);
  $('.rec-btn', card).disabled = true;
  try {
    const action = recording ? 'stop' : 'start';
    const clip = $('.clip-name', card).value.trim();
    await api(`/api/inputs/${encodeURIComponent(name)}/record/${action}`, { method: 'POST', body: recording || !clip ? {} : { clip } });
    showBanner(null);
  } catch (err) {
    showBanner(`${name}: ${err.message}`);
  } finally {
    pending.delete(name);
    await refreshInputs();
    if (recording) setTimeout(refreshRecordings, 1500);
  }
}

let lastInputNames = '';
async function refreshInputs() {
  try {
    const inputs = await api('/api/inputs');
    const names = inputs.map((i) => i.name).join(',');
    // Input set changed (added/removed/edited elsewhere): reload settings for the setup panels.
    if (names !== lastInputNames) {
      lastInputNames = names;
      await admin.refresh();
    }
    removeStaleCards(new Set(inputs.map((i) => i.name)));
    inputs.forEach(renderInput);
    $('#no-inputs').hidden = inputs.length > 0;
    setConn(true);
  } catch (err) {
    setConn(false);
    showBanner(`Status update failed: ${err.message}`);
  }
}

// --- recordings -----------------------------------------------------------
function cell(text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

async function refreshRecordings() {
  const tbody = $('#recordings');
  const all = $('#show-all').checked;
  try {
    const recs = await api(`/api/recordings${all ? '?all=1' : ''}`);
    const rows = recs.map((r) => {
      const tr = document.createElement('tr');
      tr.append(
        cell(r.clip ?? r.id ?? '—'),
        cell(r.take ? fmtTake(r.take) : '—'),
        cell(r.input ?? r.stream ?? '—'),
        cell(fmtLocal(r.startTime ?? r.modified)),
        cell(r.recordTimeMs ? fmtDuration(r.recordTimeMs) : 'in progress'),
        cell(fmtBytes(r.sizeBytes)),
        cell(r.path, 'muted'),
      );
      return tr;
    });
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.append(cell(all ? 'No recordings' : 'No recordings since the list was cleared', 'muted'));
      tr.firstChild.colSpan = 7;
      rows.push(tr);
    }
    tbody.replaceChildren(...rows);
  } catch (err) {
    showBanner(`Recordings list failed: ${err.message}`);
  }
}

$('#show-all').addEventListener('change', refreshRecordings);
$('#clear-list').addEventListener('click', async () => {
  if (!confirm('Clear the recordings list?\n\nThis only hides entries in the console. Files on disk are NOT deleted.')) return;
  try {
    applyState(await api('/api/recordings/clear', { method: 'POST' }));
    refreshRecordings();
  } catch (err) {
    showBanner(`Clear failed: ${err.message}`);
  }
});

// --- boot -----------------------------------------------------------------
function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString();
}

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  try {
    applyState(await api('/api/state'));
  } catch (err) {
    showBanner(`Could not load console state: ${err.message}`);
  }
  await refreshInputs();
  refreshRecordings();
  setInterval(refreshInputs, POLL_MS);
  setInterval(refreshRecordings, RECORDINGS_POLL_MS);
}

boot();
