// Page wiring: genre picker, search, player panel, FX pad and the animated booth.
import { Engine } from './audio/engine.js';
import { AutoDJ } from './dj.js';
import { GENRES, genreFor } from './genres.js';
import { camelotLabel } from './keys.js';
import * as audius from './sources/audius.js';
import * as itunes from './sources/itunes.js';
import * as archive from './sources/archive.js';
import { FX_LIST, runFX } from './audio/fx.js';
import { initMonetization, trackEvent } from './monetize.js';
import { initTips } from './tip.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

const engine = new Engine();
const dj = new AutoDJ(engine);
window.djpj = { dj, engine }; // handy for poking at the set from the browser console

const SOURCE = { audius: 'Full track · Audius', itunes: '30-sec preview · iTunes', archive: 'Public domain · Archive' };
const SHORT = { audius: 'Full', itunes: 'Hit · 30s', archive: '1920s' };
const LINK = { audius: 'Open on Audius', itunes: 'Get the full song on Apple Music', archive: 'View on the Internet Archive' };

// ---------- settings (remembered per browser) ----------
const settings = (() => {
  // clean lyrics unless the listener opts in; the old `clean` flag is dropped so everyone starts clean
  const defaults = { mode: 'full', archive: false, explicit: false, style: 'club' };
  try {
    const { clean, ...saved } = JSON.parse(localStorage.getItem('djpj:settings') || '{}');
    return { ...defaults, ...saved };
  } catch { return defaults; }
})();
const save = () => { try { localStorage.setItem('djpj:settings', JSON.stringify(settings)); } catch { /* private mode */ } };

function syncControls() {
  document.querySelectorAll('.seg[data-bind]').forEach(seg => {
    seg.querySelectorAll('button[data-value]').forEach(b => {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(settings[seg.dataset.bind] === b.dataset.value));
    });
  });
  document.querySelectorAll('input[type=checkbox][data-bind]').forEach(cb => { cb.checked = !!settings[cb.dataset.bind]; });
  dj.style = settings.style;
  $('#fx-sub').textContent = `${settings.style[0].toUpperCase()}${settings.style.slice(1)} vibe`;
}

// ---------- dock sheets: the crate on the left, DJ effects on the right ----------
const SHEETS = { crate: ['#crate-btn', '#crate-sheet'], fx: ['#fx-btn', '#fx-sheet'] };
const narrow = matchMedia('(max-width: 720px)');

function openSheet(name, open) {
  const [btn, sheet] = SHEETS[name];
  open ??= $(sheet).hidden;
  // phones only have room for one sheet at a time
  if (open && narrow.matches) for (const k in SHEETS) if (k !== name) openSheet(k, false);
  const opening = open && $(sheet).hidden;
  $(sheet).hidden = !open;
  if (opening) $(sheet).scrollTop = 0; // reopen at the top: what's playing, then the queue
  $(btn).setAttribute('aria-expanded', String(open));
}

function bindSheets() {
  for (const [name, [btn, sheet]] of Object.entries(SHEETS)) {
    $(btn).addEventListener('click', () => openSheet(name));
    $(sheet).querySelector('[data-close]').addEventListener('click', () => openSheet(name, false));
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') for (const k in SHEETS) openSheet(k, false);
  });
  // tapping the stage closes whatever is open, so the DJ is back in view
  $('.stage').addEventListener('click', () => { for (const k in SHEETS) openSheet(k, false); });
  openSheet('crate', true); // first thing a visitor sees: the genres
  // re-measure the ticker when the dock changes width (rotating a phone, resizing a window)
  let lastW = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w !== lastW) { lastW = w; setTicker(); }
  }).observe($('.ticker'));
}

let tickerText = '';
function setTicker(text = tickerText) {
  const box = $('.ticker'), span = $('#np-ticker');
  tickerText = text;
  box.classList.remove('scroll');
  span.textContent = text;
  if (span.offsetWidth > box.clientWidth) {
    // doubled with a gap so the marquee loops seamlessly
    span.textContent = `${text}      •      ${text}      •      `;
    box.style.setProperty('--ticker-dur', `${Math.max(8, text.length / 4)}s`);
    box.classList.add('scroll');
  }
}

function say(msg) {
  const b = $('#status');
  if (b.textContent === msg) return;
  b.textContent = msg;
  b.classList.remove('pop');
  void b.offsetWidth; // restart the pop animation
  b.classList.add('pop');
}

function bindControls() {
  document.querySelectorAll('.seg[data-bind]').forEach(seg => {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      settings[seg.dataset.bind] = b.dataset.value;
      save();
      syncControls();
    });
  });
  document.querySelectorAll('input[type=checkbox][data-bind]').forEach(cb => {
    cb.addEventListener('change', () => { settings[cb.dataset.bind] = cb.checked; save(); });
  });
  syncControls();
}

// ---------- starting sets ----------
function startSet({ genreKey, seedTrack = null }) {
  engine.init(); // inside the tap, so mobile browsers allow sound
  document.querySelectorAll('.genre').forEach(b => b.classList.toggle('active', b.dataset.genre === genreKey));
  const details = $('#np-details');
  if (details.hidden) {
    details.hidden = false;
    resetNowPlaying();
  }
  const g = GENRES.find(x => x.key === genreKey);
  $('#crate-icon').textContent = g?.icon || '💿';
  $('#crate-sub').textContent = g?.label || 'Your pick';
  $('#home-title').textContent = 'Switch it up';
  ['#btn-pause', '#btn-skip'].forEach(s => { $(s).disabled = false; });
  for (const k in SHEETS) openSheet(k, false); // the DJ takes the stage
  requestWakeLock();
  dj.play({ genreKey, seedTrack, mode: settings.mode, archive: settings.archive, clean: !settings.explicit });
  trackEvent(`set/${genreKey}${seedTrack ? '/search' : ''}`);
}

function renderGenres() {
  const grid = $('#genres');
  grid.innerHTML = GENRES.map(g => `
    <button class="genre" type="button" data-genre="${g.key}" style="--hue:${g.hue}">
      <span class="icon" aria-hidden="true">${g.icon}</span>
      <span class="name">${esc(g.label)}</span>
      <span class="sub">${esc(g.sub)}</span>
    </button>`).join('');
  grid.addEventListener('click', e => {
    const b = e.target.closest('[data-genre]');
    if (b) startSet({ genreKey: b.dataset.genre });
  });
}

// ---------- search ----------
let searchToken = 0, results = [];

async function doSearch(q) {
  q = q.trim();
  const box = $('#results');
  if (q.length < 2) { box.hidden = true; return; }
  const token = ++searchToken;
  box.hidden = false;
  box.innerHTML = '<div class="muted small">Flipping through the crates…</div>';
  const [hits, full, pd] = await Promise.allSettled([
    itunes.search(q, { limit: 8, clean: !settings.explicit }),
    audius.search(q, 6),
    archive.search(q, 4),
  ]);
  if (token !== searchToken) return;
  results = [];
  const groups = [['Real hits · 30-second previews', hits], ['Full-length indie tracks', full], ['Public-domain 78s', pd]];
  const html = groups.map(([label, r]) => {
    if (r.status !== 'fulfilled' || !r.value.length) return '';
    return `<div class="group">${label}</div>` + r.value.map(t => {
      results.push(t);
      return `<button class="result" type="button" data-i="${results.length - 1}">
        <img src="${esc(t.art)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}${t.year ? ' · ' + t.year : ''}</div></div>
        <span class="badge ${t.source}">${SHORT[t.source]}</span>
      </button>`;
    }).join('');
  }).join('');
  box.innerHTML = html || '<div class="muted small">No matches. Try an artist name, or pick a genre below.</div>';
}

function bindSearch() {
  const input = $('#search');
  let timer;
  $('#search-form').addEventListener('submit', e => {
    e.preventDefault();
    clearTimeout(timer);
    doSearch(input.value);
    input.blur();
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => doSearch(input.value), 700);
  });
  $('#results').addEventListener('click', e => {
    const b = e.target.closest('.result');
    if (!b) return;
    const t = results[+b.dataset.i];
    const genreKey = t.source === 'archive' ? 'roaring20s' : genreFor(t.genre, t.year);
    startSet({ genreKey, seedTrack: t });
  });
}

// ---------- player panel ----------
let queueState = {};

function resetNowPlaying() {
  $('#np-art').removeAttribute('src');
  setTicker('Digging through the crates…');
  $('#np-title').textContent = '—';
  $('#np-artist').textContent = '';
  ['#np-source', '#np-bpm', '#np-key'].forEach(s => { $(s).textContent = ''; });
  $('#np-progress').style.width = '0';
  $('#np-time').textContent = '0:00';
  $('#np-link').hidden = true;
  $('#history').innerHTML = '';
  $('#up-next').innerHTML = '<li>Picking records…</li>';
  setPauseButton(false);
  queueState = {};
}

function setPauseButton(paused) {
  const b = $('#btn-pause');
  b.textContent = paused ? '▶' : '⏸';
  b.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
}

function showTrack(t) {
  $('#np-art').src = t.art || 'favicon.svg';
  setTicker(`${t.title} · ${t.artist}`);
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist + (t.year ? ` · ${t.year}` : '');
  const src = $('#np-source');
  src.textContent = SOURCE[t.source];
  src.className = `badge ${t.source}`;
  $('#np-bpm').textContent = t.prep ? `${Math.round(t.prep.bpm)} BPM` : '';
  $('#np-key').textContent = camelotLabel(t.key) ? `Key ${camelotLabel(t.key)}` : '';
  const link = $('#np-link');
  link.hidden = !t.link;
  link.href = t.link || '#';
  link.textContent = LINK[t.source];
  $('#history').innerHTML = dj.history.slice(0, 40).map(h => li(h, SHORT[h.source])).join('');
  queueState = {};
  renderUpNext();
  document.querySelector('.fx[data-fx="bass"]')?.setAttribute('aria-pressed', 'false');
  updateMediaSession(t);
}

const li = (t, note) => `<li><b>${esc(t.title)}</b> · ${esc(t.artist)}<span class="src">${esc(note)}</span></li>`;

function renderUpNext() {
  const items = [], shown = new Set();
  if (queueState.next) {
    items.push(li(queueState.next, queueState.transition ? `cued · ${queueState.transition}` : 'cued up'));
    shown.add(queueState.next);
  } else if (queueState.loading) {
    items.push(li(queueState.loading, 'loading…'));
    shown.add(queueState.loading);
  }
  for (const t of dj.upcoming()) if (!shown.has(t)) items.push(li(t, 'in the crate'));
  $('#up-next').innerHTML = items.slice(0, 4).join('') || '<li>Picking records…</li>';
}

function bindPlayer() {
  dj.addEventListener('status', e => say(e.detail));
  dj.addEventListener('track', e => showTrack(e.detail));
  dj.addEventListener('move', e => perform(e.detail));
  dj.addEventListener('queue', e => {
    if (e.detail.loading) queueState = { loading: e.detail.loading };
    else Object.assign(queueState, e.detail);
    renderUpNext();
  });

  $('#btn-pause').addEventListener('click', async () => {
    engine.init();
    setPauseButton(await dj.togglePause());
  });
  $('#btn-skip').addEventListener('click', () => dj.skip());
  $('#btn-stop').addEventListener('click', () => {
    dj.stop();
    setMove(null);
    setFace(null);
    $('#np-details').hidden = true;
    $('#np-art').removeAttribute('src');
    $('#np-progress').style.width = '0';
    $('#np-time').textContent = '0:00';
    setTicker('Nothing spinning yet. Open the crate to start a set.');
    say('Pick a vibe. DJPJ spins the rest.');
    $('#crate-icon').textContent = '💿';
    $('#crate-sub').textContent = 'Pick a genre';
    ['#btn-pause', '#btn-skip'].forEach(s => { $(s).disabled = true; });
    $('#home-title').textContent = 'What are we spinning?';
    document.querySelectorAll('.genre.active').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.fx[aria-pressed]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    if (engine.ctx) {
      engine.flanger.set(false);
      engine.phaser.set(false);
    }
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  });
  $('#volume').addEventListener('input', e => {
    if (engine.ctx) engine.volume.gain.setTargetAtTime(+e.target.value, engine.now, 0.03);
  });

  const pad = $('#fx-pad');
  pad.innerHTML = FX_LIST.map(f => `
    <button class="fx" type="button" data-fx="${f.id}" ${f.toggle ? 'aria-pressed="false"' : ''}>
      <span class="i" aria-hidden="true">${f.icon}</span><span>${esc(f.label)}</span>
    </button>`).join('');
  pad.addEventListener('click', e => {
    const b = e.target.closest('.fx');
    if (!b || !dj.current) return;
    engine.init();
    const on = runFX(b.dataset.fx, dj);
    perform(`fx:${b.dataset.fx}`);
    if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(!!on));
    b.classList.remove('flash');
    void b.offsetWidth; // restart the flash animation
    b.classList.add('flash');
    setTimeout(() => b.classList.remove('flash'), 180);
  });

  document.addEventListener('keydown', e => {
    if (!dj.current || e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#btn-pause').click(); }
    if (e.key === 'n' || e.key === 'N') dj.skip();
  });
}

// ---------- phones: lock-screen controls and keeping the screen awake ----------
let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dj.current) requestWakeLock();
});

function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist, album: 'DJPJ live set',
    artwork: t.art ? [{ src: t.art, sizes: '512x512' }] : [],
  });
}
if ('mediaSession' in navigator) {
  const toggle = async want => { if (dj.paused !== want) $('#btn-pause').click(); };
  navigator.mediaSession.setActionHandler('play', () => toggle(false));
  navigator.mediaSession.setActionHandler('pause', () => toggle(true));
  navigator.mediaSession.setActionHandler('nexttrack', () => dj.skip());
}

// ---------- the animated booth + visualizer ----------
const booth = $('#booth');
const stage = $('.stage');

// ---------- DJPJ's moves, faces and emotes ----------
// Each cue from the set (a transition, trick or flourish) gets a dance move for a few bars,
// sometimes a face, and emotes that float up from his head.
const MOVES = {
  big: { move: 'hype', bars: 4, face: 'shout', emotes: ['🔥', '🙌', '🎉'], word: "LET'S GO!" },
  drop: { move: 'hype', bars: 2, face: 'shout', emotes: ['💥', '🔥'] },
  slam: { move: 'headbang', bars: 2, face: 'shout', emotes: ['💥'] },
  blend: { move: 'sway', bars: 4, emotes: ['😎'] },
  filter: { move: 'lean', bars: 2, emotes: ['🎚️'] },
  loopout: { move: 'lean', bars: 2, emotes: ['🔁'] },
  roll: { move: 'headbang', bars: 2, emotes: ['🥁'] },
  echo: { move: 'wave', bars: 2, emotes: ['👋'] },
  cut: { move: 'lean', bars: 1, emotes: ['💿'] },
  spin: { move: 'lean', bars: 1, face: 'surprise', emotes: ['🌀'] },
  brake: { move: 'lean', bars: 1, face: 'surprise', emotes: ['🛑'] },
  wash: { move: 'wave', bars: 4, emotes: ['🌊', '✨'] },
  land: { emotes: ['🎶'] },
  rewind: { move: 'point', bars: 2, face: 'shout', emotes: ['🔁', '😤'], word: 'PULL UP!' },
  callback: { move: 'wave', bars: 4, emotes: ['🎙️', '💯'], word: 'REMEMBER THIS?' },
  tease: { move: 'point', bars: 2, face: 'surprise', emotes: ['👀', '🤫'] },
  flair: { move: 'lean', bars: 1, emotes: ['✨'] },
  tip: { move: 'hype', bars: 2, face: 'shout', emotes: ['💸', '🙏', '💛'], word: 'THANK YOU!' },
  'fx:airhorn': { move: 'hype', bars: 1, face: 'shout', emotes: ['📢'] },
  'fx:scratch': { move: 'lean', bars: 1, emotes: ['💿'] },
  'fx:echo': { move: 'wave', bars: 1, emotes: ['🔁'] },
  'fx:reverb': { move: 'sway', bars: 2, emotes: ['🌊'] },
  'fx:filter': { move: 'lean', bars: 2, emotes: ['🎚️'] },
  'fx:roll': { move: 'headbang', bars: 1, emotes: ['🥁'] },
  'fx:gate': { move: 'headbang', bars: 1, emotes: ['✂️'] },
  'fx:boom': { move: 'hype', bars: 1, face: 'shout', emotes: ['💥'] },
  'fx:flanger': { move: 'sway', bars: 2, emotes: ['🌀'] },
  'fx:phaser': { move: 'sway', bars: 2, emotes: ['🪐'] },
  'fx:bass': { move: 'headbang', bars: 1, emotes: ['🔊'] },
  'fx:riser': { move: 'point', bars: 2, face: 'surprise', emotes: ['🚀'] },
  'fx:laser': { move: 'point', bars: 1, emotes: ['⚡'] },
  'fx:siren': { move: 'wave', bars: 2, emotes: ['🚨'] },
  'fx:spin': { move: 'lean', bars: 1, face: 'surprise', emotes: ['⏪'] },
  'fx:brake': { move: 'lean', bars: 1, face: 'surprise', emotes: ['🛑'] },
};
// between cues he still works the crowd, more often the harder the vibe
const IDLE = {
  smooth: { odds: 0.3, moves: ['sway', 'sway', 'wave'], emotes: ['😎', '🎶', '✨'] },
  club: { odds: 0.45, moves: ['sway', 'headbang', 'wave', 'lean'], emotes: ['😎', '🎶', '🔥', '🕺', '💃'] },
  hype: { odds: 0.65, moves: ['headbang', 'hype', 'wave', 'point'], emotes: ['🔥', '🙌', '🤘', '💯', '🕺'] },
};
const pickOne = list => list[Math.floor(Math.random() * list.length)];
const beatSec = () => parseFloat(getComputedStyle(stage).getPropertyValue('--beat')) || 0.5;
let moveTimer, faceTimer, nextIdle = 0;

function setMove(name, secs) {
  booth.classList.forEach(c => c.startsWith('move-') && booth.classList.remove(c));
  clearTimeout(moveTimer);
  if (!name) return;
  booth.classList.add(`move-${name}`);
  moveTimer = setTimeout(() => booth.classList.remove(`move-${name}`), secs * 1000);
}

function setFace(name, secs) {
  booth.classList.remove('face-shout', 'face-surprise');
  clearTimeout(faceTimer);
  if (!name) return;
  booth.classList.add(`face-${name}`);
  faceTimer = setTimeout(() => booth.classList.remove(`face-${name}`), Math.min(secs, 2.4) * 1000);
}

function emote(text, word = false) {
  const layer = $('#emotes');
  if (layer.childElementCount > 8) layer.firstElementChild.remove();
  const wrap = layer.getBoundingClientRect(), svg = booth.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = word ? 'emote word' : 'emote';
  el.textContent = text;
  // around his head: x 180-300, y 40 in the booth's 480x420 drawing
  const x = svg.left - wrap.left + svg.width * ((word ? 240 : 180 + Math.random() * 120) / 480);
  el.style.left = `${x}px`;
  el.style.top = `${svg.top - wrap.top + svg.height * ((word ? 20 : 40) / 420)}px`;
  el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 60)}px`);
  el.style.setProperty('--tilt', `${Math.round((Math.random() - 0.5) * 30)}deg`);
  el.addEventListener('animationend', () => el.remove());
  layer.appendChild(el);
}

function perform(kind) {
  const m = MOVES[kind];
  if (!m || dj.paused) return;
  const secs = (m.bars || 1) * 4 * beatSec();
  if (dj.current) {
    if (m.move) setMove(m.move, secs);
    if (m.face) setFace(m.face, secs);
    nextIdle = (engine.now || 0) + secs + 4 * beatSec();
  }
  m.emotes.forEach((e, i) => setTimeout(() => emote(e), i * 220));
  if (m.word) setTimeout(() => emote(m.word, true), 120);
}

function idleMoves(now, beat) {
  if (now < nextIdle) return;
  nextIdle = now + 8 * beat;
  const idle = IDLE[settings.style] || IDLE.club;
  if (booth.getAttribute('class').includes('move-') || Math.random() > idle.odds) return;
  setMove(pickOne(idle.moves), 4 * beat * (Math.random() < 0.5 ? 1 : 2));
  if (Math.random() < 0.6) emote(pickOne(idle.emotes));
}
const xfader = $('#xfader');
const canvas = $('#viz');
const g2d = canvas.getContext('2d');
let bins = null, lastBeat = '';

function drawViz() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  g2d.clearRect(0, 0, canvas.width, canvas.height);
  const an = engine.analyser;
  bins = bins || new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(bins);
  const n = 48, bw = canvas.width / n;
  const grad = g2d.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, '#ff3da8');
  grad.addColorStop(0.5, '#ffb020');
  grad.addColorStop(1, '#22e3ff');
  g2d.fillStyle = grad;
  let level = 0;
  for (let i = 0; i < n; i++) {
    // mirror from the center out so the bass sits in the middle
    const k = Math.floor((Math.abs(i - n / 2) / (n / 2)) * 80);
    const v = bins[k] / 255;
    level += v;
    const bh = v * canvas.height;
    g2d.fillRect(i * bw + 1, canvas.height - bh, bw - 2, bh);
  }
  return level / n;
}

function frame() {
  requestAnimationFrame(frame);
  const cur = dj.current;
  booth.classList.toggle('playing', !!cur && !dj.waiting);
  booth.classList.toggle('paused', dj.paused);
  if (!engine.ctx) return;
  const now = engine.now;
  const [A, B] = engine.decks;
  booth.classList.toggle('a-on', A.isPlaying(now));
  booth.classList.toggle('b-on', B.isPlaying(now));

  for (const d of engine.decks) {
    if (d.track !== d.shownTrack) {
      d.shownTrack = d.track;
      booth.querySelector(`.deck-${d.name.toLowerCase()} .label-art`).setAttribute('href', d.track?.art || '');
    }
  }
  const a = A.fader.gain.value, b = B.fader.gain.value;
  const x = a + b > 0.001 ? b / (a + b) : 0.5;
  xfader.setAttribute('x', (222 + x * 28).toFixed(1));

  if (cur && !dj.paused) {
    const p = cur.track.prep;
    const beat = (60 / (p.bpm * cur.deck.rateAt(now))).toFixed(2) + 's';
    if (beat !== lastBeat) { stage.style.setProperty('--beat', beat); lastBeat = beat; }
    idleMoves(now, parseFloat(beat));
    const pos = cur.deck.posAt(now);
    const total = p.outPoint - p.inPoint;
    $('#np-progress').style.width = `${Math.min(100, Math.max(0, ((pos - p.inPoint) / total) * 100))}%`;
    $('#np-time').textContent = `${fmt(pos - p.inPoint)} / ${fmt(total)}`;
  }
  let level = 0;
  if (cur) level = drawViz();
  else g2d.clearRect(0, 0, canvas.width, canvas.height);
  for (const [sel, d] of [['.vu-a', A], ['.vu-b', B]]) {
    const hgt = 2 + Math.min(1, level * 2.2 * d.fader.gain.value) * 10;
    const el = booth.querySelector(sel);
    el.setAttribute('height', hgt.toFixed(1));
    el.setAttribute('y', (246 - hgt).toFixed(1));
  }
}

// ---------- go ----------
renderGenres();
bindControls();
bindSheets();
bindSearch();
bindPlayer();
initMonetization();
initTips();
// a successful tip gets an air horn salute if a set is playing
window.addEventListener('djpj:tipped', () => {
  trackEvent('tip');
  $('.tip-jar').classList.add('jingle');
  setTimeout(() => $('.tip-jar').classList.remove('jingle'), 700);
  perform('tip');
  if (dj.current) runFX('airhorn', dj);
});
requestAnimationFrame(frame);
