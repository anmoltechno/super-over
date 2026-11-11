// Super Over in a browser: the game itself is the Swift engine compiled to WebAssembly
// (Packages/CricketKit, CricketWeb). This file runs it, draws its frames, passes it your touches,
// builds the menus and the scoreboard from the state it reports, and carries its messages to an
// opponent in a match online.
import { wasiImports } from './wasi.js?v=3e8390bab3';
import { drawList } from './renderer.js?v=3e8390bab3';
import { Scene3D } from './scene3d.js?v=3e8390bab3';
import { Sound } from './audio.js?v=3e8390bab3';
import { Link, NET_VERSION } from './net.js?v=3e8390bab3';

/// This build (web/deploy.sh stamps it): two players online must be on the same one.
const BUILD = '3e8390bab3';

const canvas = document.getElementById('stage');
const ui = document.getElementById('ui');
const fx = document.getElementById('fx');
const params = new URLSearchParams(location.search);
const sound = new Sound();
/// ?netlog: what the two devices say to each other in a match online, in the console.
const netlog = params.has('netlog');
// The match is drawn in 3D with WebGL; where that isn't to be had (or with ?gl=0), the engine
// draws it itself on a 2D canvas.
let scene3d = null;
let ctx = null;
const bgCanvas = document.createElement('canvas');
let bgCtx = null;

let x = null;
let memory = null;
let catalog = null;
let state = null;
let screen = 'loading';
let lastTime = 0;
let dpr = 1;
let width = 0;
let height = 0;
let recordedVersion = null;
let lastMode = null;
let selectedField = 'balanced';
let leaving = false;
const down = new Set();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const today = Math.max(1, Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 86400000) + 1);

// MARK: Progress, kept in this browser.

const SAVE = 'superover.v1';
// New players get a side of their own, so two strangers online aren't both Super Strikers.
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const firstSide = () => `${pick(['Super', 'Royal', 'Golden', 'Midnight', 'Thunder', 'Silver', 'Scarlet', 'Rising', 'Mighty', 'Flying'])} ${pick(['Strikers', 'Kites', 'Tigers', 'Sixers', 'Chargers', 'Lions', 'Comets', 'Stallions', 'Hurricanes', 'Blazers'])}`;
const progress = Object.assign({ coins: 300, stars: {}, wins: [], blitzBest: 0, dailyWins: [], matches: 0, won: 0, sixes: 0, team: firstSide(), kit: 0,
  online: 0, onlineWon: 0 }, JSON.parse(localStorage.getItem(SAVE) || '{}'));
if (!localStorage.getItem(SAVE)) localStorage.setItem(SAVE, JSON.stringify(progress));
const save = () => localStorage.setItem(SAVE, JSON.stringify(progress));
const totalStars = () => Object.values(progress.stars).reduce((a, b) => a + b, 0);
const stopUnlocked = (index) => index === 0 || progress.wins.includes(catalog.stops[index - 1].id);
const nextStop = () => catalog.stops.find((s, i) => !progress.wins.includes(s.id) && stopUnlocked(i)) || catalog.stops[catalog.stops.length - 1];
// The engine's kits (Kit.palette): shirt and trim.
const KITS = [['#1565C0', '#FFD54F'], ['#E53935', '#FFFFFF'], ['#2E7D32', '#FFEB3B'], ['#FF8F00', '#1A237E'], ['#6A1B9A', '#F9A825'], ['#00838F', '#FFFFFF'],
  ['#212121', '#FFC400'], ['#F06292', '#263238']];
const myKit = () => KITS[progress.kit % KITS.length];

// MARK: The engine.

// Pointers first, then the memory's buffer: asking the engine for a pointer can grow its memory,
// which detaches any view taken before.
function command(object) {
  const bytes = encoder.encode(JSON.stringify(object));
  const inbox = x.so_inbox();
  new Uint8Array(memory.buffer, inbox, bytes.length).set(bytes);
  return x.so_command(bytes.length);
}

function readText(pointer, length) {
  return decoder.decode(new Uint8Array(memory.buffer, pointer, length).slice());
}

function floats(pointer, length) {
  return new Float32Array(memory.buffer, pointer, length);
}

function tellTeam() {
  command({ cmd: 'team', team: progress.team, short: shortName(progress.team), kit: progress.kit });
}

async function boot() {
  renderLoading(0);
  const response = await fetch('super-over.wasm?v=3e8390bab3');
  // The engine's size (web/deploy.sh stamps the real one): a compressed response's
  // content-length counts the compressed bytes, not the ones the reader hands over.
  const total = 13625537;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    renderLoading(Math.min(0.97, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasiImports(() => memory) });
  x = instance.exports;
  memory = x.memory;
  x._initialize();
  const length = x.so_init(today);
  const pointer = x.so_text_ptr();
  catalog = JSON.parse(readText(pointer, length));
  tellTeam();
  // 3D, unless it has failed on this device before (?gl=1 tries it again) or ?gl=0 asks for the flat renderer.
  if (params.get('gl') === '1') localStorage.removeItem('superover.gl');
  if (params.get('gl') !== '0' && localStorage.getItem('superover.gl') !== '0') {
    scene3d = Scene3D.create(canvas, catalog.grounds, { quality: params.has('quality') ? Number(params.get('quality')) : null });
  }
  if (scene3d) {
    x.so_draws3d(1);
  } else {
    ctx = canvas.getContext('2d', { alpha: false });
    bgCtx = bgCanvas.getContext('2d', { alpha: false });
  }
  resize();
  go('home');
  openLink();
  requestAnimationFrame(frame);
  // Registered once the engine is in, so the worker's copy comes from the HTTP cache.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// MARK: Installing.

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (screen === 'home') render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (screen === 'home') render();
});
const installed = () => ['standalone', 'fullscreen'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installHTML() {
  if (installed()) return '';
  if (installPrompt) return `<button class="install" data-action="install">${icon('download')} Install Super Over · plays offline</button>`;
  if (isApple()) return `<button class="install" data-action="install-apple">${icon('download')} Add Super Over to your Home Screen</button>`;
  return '';
}

function appleInstallHTML() {
  return overlay(`<h2>Add to Home Screen</h2>
    <p class="dim">Super Over then opens full screen from its own icon, and plays offline.</p>
    <div class="objectives"><div>1. In Safari, tap <b>Share</b> (on iOS 26 it's in the <b>⋯</b> menu)</div>
      <div>2. Choose <b>Add to Home Screen</b></div><div>3. Tap <b>Add</b></div></div>
    <button class="big primary" data-action="close"><b>Got it</b></button>`);
}

// Links straight into a mode: ?play=blitz (also quick, superover, friend, daily, nets, tour, online),
// and ?join=ABCD into a friend's match.
function openLink() {
  const join = (params.get('join') || '').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4);
  if (join.length === 4) {
    go('online');
    return connect('join', join);
  }
  const play = params.get('play');
  if (play === 'tour') return go('tour');
  if (play === 'online') return go('online');
  const modes = {
    quick: () => ({ mode: 'quick', ...quick }),
    superover: () => ({ mode: 'superover', difficulty: superDifficulty }),
    friend: () => ({ mode: 'superover', friend: true }),
    blitz: () => ({ mode: 'blitz' }),
    daily: () => ({ mode: 'daily', day: today }),
    nets: () => ({ mode: 'nets', ...nets }),
  };
  if (modes[play]) start(modes[play]());
}

function shortName(name) {
  const words = name.split(/\s+/).filter(Boolean);
  let letters = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join('') : '';
  if (letters.length < 3) letters = name.replace(/[^a-z]/gi, '').slice(0, 3);
  return (letters || 'YOU').toUpperCase();
}

// MARK: Frames.

let frames = 0;

function frame(now) {
  const dt = lastTime ? (now - lastTime) / 1000 : 1 / 60;
  lastTime = now;
  frames += 1;
  const flags = x.so_frame(dt);
  if (scene3d) {
    if (flags & 16) {
      const pointer = x.so_scene_ptr(), length = x.so_scene_len();
      try {
        scene3d.render(floats(pointer, length), dt);
      } catch (error) {
        scene3d.failed = String(error?.message || error);
      }
      if (scene3d.failed) return flatFromNowOn(scene3d.failed);
    }
  } else {
    draw2D(flags);
  }
  if (flags & 4) {
    const pointer = x.so_text_ptr(), length = x.so_text_len();
    onState(JSON.parse(readText(pointer, length)));
  }
  if (flags & 8) {
    const pointer = x.so_cues_ptr(), length = x.so_cues_len();
    onCues(readText(pointer, length));
  }
  if (flags & 32) {
    // What the engine has to tell the other device in a match online.
    const pointer = x.so_net_ptr(), length = x.so_net_len();
    const text = readText(pointer, length);
    if (link) {
      for (const line of text.split('\n')) {
        if (netlog && !line.includes('"t":"time"')) console.log(`> ${line}`);
        link.send({ g: line });
      }
    }
  }
  requestAnimationFrame(frame);
}

/// The 3D renderer can't draw on this device: remember that, and start again with the flat one.
function flatFromNowOn(why) {
  console.warn(`3D renderer failed (${why}); using the flat renderer`);
  localStorage.setItem('superover.gl', '0');
  link?.close();
  location.reload();
}

function draw2D(flags) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(x.so_shake_x(), x.so_shake_y());
  const bgPointer = x.so_bg_ptr(), bgLength = x.so_bg_len();
  const fgPointer = x.so_fg_ptr(), fgLength = x.so_fg_len();
  if (flags & 2) {
    drawList(ctx, floats(bgPointer, bgLength));
  } else {
    if (flags & 1) {
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawList(bgCtx, floats(bgPointer, bgLength));
    }
    ctx.drawImage(bgCanvas, 0, 0, width, height);
  }
  drawList(ctx, floats(fgPointer, fgLength));
}

function onCues(text) {
  for (const line of text.split('\n')) {
    if (line.startsWith('@')) {
      const [name, level] = line.slice(1).split('=');
      sound.bed(name, Number(level));
    } else {
      const [name, volume] = line.split(':');
      sound.play(name, Number(volume));
    }
  }
}

function safeInsets() {
  const probe = document.getElementById('probe');
  const style = getComputedStyle(probe);
  return { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (scene3d) {
    scene3d.resize(width, height, window.devicePixelRatio || 1);
  } else {
    for (const c of [canvas, bgCanvas]) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const insets = safeInsets();
  const landscape = width > height * 1.15;
  document.body.classList.toggle('wide', landscape);
  if (x) x.so_resize(width, height, insets.top + (landscape ? 64 : 96), insets.bottom + (landscape ? 64 : 126));
}

window.addEventListener('resize', resize);

// MARK: Touch.

const phaseOf = { pointerdown: 0, pointermove: 1, pointerup: 2, pointercancel: 3 };
for (const type of Object.keys(phaseOf)) {
  canvas.addEventListener(type, (e) => {
    if (!x) return;
    e.preventDefault();
    if (type === 'pointerdown') {
      sound.unlock();
      down.add(e.pointerId);
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    } else if (!down.has(e.pointerId)) {
      return;
    }
    const events = type === 'pointermove' && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const p of events.length ? events : [e]) x.so_touch(e.pointerId, phaseOf[type], p.clientX, p.clientY, p.timeStamp / 1000);
    if (type === 'pointerup' || type === 'pointercancel') down.delete(e.pointerId);
  }, { passive: false });
}
document.addEventListener('pointerdown', () => sound.unlock(), { once: false, passive: true });

// MARK: Pieces.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stars = (n, size = '') => `<span class="stars ${size}">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
const badge = (short, shirt, trim, size = 34) =>
  `<span class="badge" style="width:${size}px;height:${size}px;background:${shirt};border-color:${trim};color:${trim};font-size:${size * 0.36}px">${esc(short)}</span>`;
const coins = (n) => `<span class="coins"><b>C</b>${n}</span>`;
const wordmark = () => `<div class="wordmark"><div>SUPER</div><div class="row"><span class="ball"></span><span class="ver">VER</span></div></div>`;

// Line icons on a 24 × 24 grid.
const ICONS = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 2 1.2 2.8 2 3 0-3.5-.5-6 1-9.5z" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  six: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8.2c-3 .2-4.7 2.5-4.7 5.2a2.6 2.6 0 1 0 2.6-2.6c-1 0-1.9.5-2.4 1.3"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 15.8a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c2.2.7 3.5 2.5 3.5 5.2"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M17.8 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 13v6.5h14V13"/>',
  home: '<path d="M4 11.5 12 4l8 7.5V20h-5.5v-5h-5v5H4z"/>',
  again: '<path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5"/>',
  flag: '<path d="M5 21V4M5 4.5c5-2.5 7 2.5 13 0v8.5c-6 2.5-8-2.5-13 0"/>',
  next: '<path d="M5 5.5v13l9-6.5zM17.5 5v14"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H9.5"/>',
  spin: '<path d="M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1"/>',
  download: '<path d="M12 4v11.5M7.5 11 12 15.5 16.5 11M5 20h14"/>',
  door: '<path d="M14 4H6v16h8M10 12h10M16.5 8.5 20 12l-3.5 3.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bat: '<path d="m14.5 3.5 6 6-9.5 9.5-3-.5-.5-3zM7 16l-3.5 3.5"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// MARK: Screens.

function go(next) {
  // Leaving the lobby calls off the search.
  if (next !== 'online') hangUp();
  screen = next;
  if (next !== 'match') {
    state = null;
    clearEffects();
  }
  if (['home', 'tour', 'quick', 'superover', 'nets', 'online'].includes(next) && lastMode !== 'demo') {
    command({ cmd: 'demo', seed: Date.now() % 100000 });
    lastMode = 'demo';
  }
  render();
}

function start(options) {
  sound.unlock();
  sound.play('tap', 0.6);
  hangUp();
  lastMode = options.mode;
  recordedVersion = null;
  leaving = false;
  clearEffects();
  command({ cmd: 'start', seed: Date.now() % 1_000_000, ...options });
  screen = 'match';
  window.__lastStart = options;
  render();
}

function render() {
  if (screen === 'match') return renderMatch();
  const html = {
    loading: '',
    home: homeHTML,
    tour: tourHTML,
    quick: quickHTML,
    superover: superOverHTML,
    nets: netsHTML,
    online: onlineHTML,
  }[screen];
  ui.innerHTML = `<div class="shade ${screen}"></div>${typeof html === 'function' ? html() : html}`;
}

function renderLoading(fraction) {
  ui.innerHTML = `<div class="loading">${wordmark()}<div class="bar"><span style="width:${Math.round(fraction * 100)}%"></span></div>
    <p>Rolling the pitch…</p></div>`;
}

function tile(attrs, name, title, sub) {
  return `<button class="tile" ${attrs}><span class="glyph">${icon(name)}</span><span class="words"><b>${title}</b><small>${sub}</small></span></button>`;
}

function homeHTML() {
  const next = nextStop();
  const [shirt, trim] = myKit();
  return `<div class="screen home">
    <header class="topbar"><div class="who">${badge(shortName(progress.team), shirt, trim, 30)}<span>${esc(progress.team)}</span></div>
      <div class="row">${coins(progress.coins)}<button class="round small" data-action="mute" aria-label="Sound">${icon(sound.muted ? 'mute' : 'sound')}</button></div></header>
    <div class="hero">${wordmark()}<p>QUICK-FIRE CRICKET</p></div>
    <nav class="menu">
      <button class="cta online" data-go="online"><span class="glyph">${icon('wifi')}</span><span class="words"><b>Play Online</b><small>A friend, or anyone in the world</small></span><em>LIVE</em></button>
      <button class="cta tour" data-go="tour"><span class="glyph">${icon('globe')}</span><span class="words"><b>World Tour</b><small>Next: ${next.id} ${esc(next.title)} · ${totalStars()}/90 ★</small></span>${icon('play')}</button>
      <div class="tiles">
        ${tile('data-go="quick"', 'bolt', 'Quick Match', 'Toss, bat, bowl')}
        ${tile('data-go="superover"', 'six', 'Super Over', 'CPU or pass and play')}
        ${tile(`data-start='{"mode":"blitz"}'`, 'flame', 'Blitz', `Best ${progress.blitzBest}`)}
        ${tile(`data-start='{"mode":"daily","day":${today}}'`, 'calendar', 'Daily Chase', progress.dailyWins.includes(today) ? 'Won today ✓' : esc(catalog.daily[0]))}
        ${tile('data-go="nets"', 'target', 'Nets', 'Practice')}
        ${tile('data-go="online"', 'users', 'With a Friend', 'Share a code')}
      </div>
      ${installHTML()}
      <p class="note">Swipe where you want the ball to go. Flick hard to loft it.</p>
    </nav></div>`;
}

function header(title, subtitle) {
  return `<div class="head"><button class="round" data-go="home" aria-label="Back">${icon('back')}</button><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></div>`;
}

function tourHTML() {
  const legs = [];
  for (let i = 0; i < catalog.stops.length; i += 5) legs.push(catalog.stops.slice(i, i + 5).map((s, k) => [s, i + k]));
  return `<div class="screen list">${header('World Tour', `${totalStars()} of 90 stars`)}
    ${legs.map((leg) => {
      const first = leg[0][0];
      const open = stopUnlocked(leg[0][1]);
      return `<section class="panel leg ${open ? '' : 'locked'}"><div class="legtop"><div><h2>${esc(first.ground)}</h2><p>${esc(first.tagline)}</p></div>${badge(first.short, first.shirt, first.trim, 34)}</div>
        <div class="stops">${leg.map(([s, index]) => {
          const unlocked = stopUnlocked(index);
          const isNext = s.id === nextStop().id;
          return `<button class="stop ${isNext ? 'next' : ''}" ${unlocked ? `data-start='{"mode":"tour","stop":"${s.id}"}'` : 'disabled'}>
            <b>${s.id}</b>${unlocked ? stars(progress.stars[s.id] || 0, 'tiny') : '<span class="lock">🔒</span>'}</button>`;
        }).join('')}</div></section>`;
    }).join('')}</div>`;
}

const quick = Object.assign({ overs: 2, wickets: 3, difficulty: 'pro', venue: 'harbourOval', opponent: 'hawks' }, JSON.parse(localStorage.getItem('superover.quick') || '{}'));

function chips(name, options, current) {
  return `<div class="chips">${options.map(([value, label, detail]) =>
    `<button class="chip ${String(value) === String(current) ? 'on' : ''}" data-set="${name}" data-value="${value}"><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</button>`).join('')}</div>`;
}

function quickHTML() {
  return `<div class="screen list">${header('Quick Match', 'Your rules, a toss, then play')}
    <h3>OVERS</h3>${chips('overs', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], quick.overs)}
    <h3>WICKETS</h3>${chips('wickets', [[2, '2'], [3, '3'], [5, '5']], quick.wickets)}
    <h3>OPPONENT</h3><div class="teams">${catalog.teams.map((t) => `<button class="team ${t.id === quick.opponent ? 'on' : ''}" data-set="opponent" data-value="${t.id}">${badge(t.short, t.shirt, t.trim, 28)}<span>${esc(t.name)}</span></button>`).join('')}</div>
    <h3>GROUND</h3>${chips('venue', catalog.venues.map((v) => [v[0], v[1], v[2]]), quick.venue)}
    <h3>DIFFICULTY</h3>${chips('difficulty', catalog.difficulties.map((d) => [d[0], d[1], d[2]]), quick.difficulty)}
    <button class="big primary" data-action="quickstart">${icon('coin')}<span><b>To the toss</b><small>${quick.overs} over${quick.overs > 1 ? 's' : ''} a side</small></span></button></div>`;
}

let superDifficulty = 'pro';
function superOverHTML() {
  return `<div class="screen list">${header('Super Over', 'One over each. Two wickets. Most runs wins.')}
    <h3>AGAINST THE GRAND ROYALS</h3>${chips('superDifficulty', catalog.difficulties.map((d) => [d[0], d[1], d[2]]), superDifficulty)}
    <button class="big primary" data-action="superstart">${icon('bat')}<span><b>Play the CPU</b><small>Under the lights at the Grand Arena</small></span></button>
    <h3>WITH A FRIEND</h3>
    <button class="big" data-start='{"mode":"superover","friend":true}'>${icon('users')}<span><b>Pass and play</b><small>One phone: one of you bowls, the other bats</small></span></button>
    <button class="big" data-go="online">${icon('wifi')}<span><b>Play online</b><small>Each on your own phone</small></span></button></div>`;
}

const nets = { batting: true, style: 'fast', difficulty: 'pro' };
function netsHTML() {
  return `<div class="screen list">${header('Nets', 'No scoreboard pressure.')}
    ${chips('netsBatting', [['1', 'Batting', 'Face the bowler'], ['0', 'Bowling', 'Bowl at a batter']], nets.batting ? '1' : '0')}
    ${nets.batting ? `<h3>FACING</h3>${chips('netsStyle', [['fast', 'Fast'], ['swing', 'Swing'], ['offSpin', 'Off-spin'], ['legSpin', 'Leg-spin']], nets.style)}` : ''}
    <h3>DIFFICULTY</h3>${chips('netsDifficulty', catalog.difficulties.map((d) => [d[0], d[1]]), nets.difficulty)}
    <button class="big primary" data-action="netsstart">${icon('target')}<span><b>Into the nets</b><small>Finish from the pause menu</small></span></button></div>`;
}

// MARK: Online.

let link = null;
/// Where you are in finding a match: 'menu', 'searching', 'opening', 'hosting', 'joining', 'starting', 'error'.
const lobby = { stage: 'menu', code: '', message: '', since: 0, kind: null };
const rematch = { mine: false, theirs: false };
const friendly = Object.assign({ overs: 2, wickets: 3, venue: 'grandArena' }, JSON.parse(localStorage.getItem('superover.friendly') || '{}'));
let lobbyTimer = null;

const me = () => ({ name: progress.team.slice(0, 22) || 'Super Strikers', short: shortName(progress.team), kit: progress.kit });
const joinURL = (code) => `${location.origin}${location.pathname}?join=${code}`;

function onlineHTML() {
  const [shirt, trim] = myKit();
  let body;
  switch (lobby.stage) {
    case 'searching': {
      const waited = Math.floor((performance.now() - lobby.since) / 1000);
      body = `<section class="panel lobby"><div class="radar"><i></i><i></i><i></i>${icon('search')}</div>
        <h2>Finding an opponent…</h2><p class="dim">Two overs a side, three wickets. ${waited >= 20 ? 'Nobody\'s about just now. Stay here, or send a friend a code.' : 'Hang on.'}</p>
        ${waited >= 20 ? `<button class="big" data-action="host">${icon('users')}<span><b>Invite a friend instead</b><small>Share a code or a link</small></span></button>` : ''}
        <button class="big quiet" data-action="cancel-online"><b>Cancel</b></button></section>`;
      break;
    }
    case 'hosting':
      body = `<section class="panel lobby"><p class="tag gold">YOUR MATCH CODE</p><div class="code">${lobby.code.split('').map((c) => `<b>${c}</b>`).join('')}</div>
        <p class="dim">Your friend opens Super Over, taps <b>Play Online</b> and enters this code. Or send them the link.</p>
        <button class="big primary" data-action="share">${icon('share')}<span><b>Send the link</b><small>${esc(joinURL(lobby.code).replace(/^https?:\/\//, ''))}</small></span></button>
        <div class="waiting"><span class="dots"><i></i><i></i><i></i></span> Waiting for your friend</div>
        <button class="big quiet" data-action="cancel-online"><b>Cancel</b></button></section>`;
      break;
    case 'opening':
    case 'joining':
    case 'starting': {
      const [title, line] = { opening: ['Setting up…', 'Getting you a match code.'], joining: [`Joining ${esc(lobby.code)}…`, 'Connecting to your friend.'],
        starting: ['Opponent found!', 'Walking out to the middle…'] }[lobby.stage];
      body = `<section class="panel lobby"><div class="radar"><i></i><i></i><i></i>${icon('wifi')}</div>
        <h2>${title}</h2><p class="dim">${line}</p>
        <button class="big quiet" data-action="cancel-online"><b>Cancel</b></button></section>`;
      break;
    }
    case 'error':
      body = `<section class="panel lobby"><h2>That didn't work</h2><p class="dim">${esc(lobby.message)}</p>
        <button class="big primary" data-action="online-menu"><b>OK</b></button></section>`;
      break;
    default:
      body = `<section class="panel me"><h3>YOUR SIDE</h3>
          <div class="row">${badge(shortName(progress.team), shirt, trim, 40)}<input id="teamname" maxlength="22" value="${esc(progress.team)}" aria-label="Team name" autocomplete="off" spellcheck="false"></div>
          <div class="swatches">${KITS.map(([s, t], i) => `<button class="${i === progress.kit ? 'on' : ''}" data-set="kit" data-value="${i}" style="background:${s};border-color:${t}" aria-label="Kit ${i + 1}"></button>`).join('')}</div>
        </section>
        <button class="cta online" data-action="find"><span class="glyph">${icon('search')}</span><span class="words"><b>Find a Match</b><small>Anyone, anywhere · 2 overs a side</small></span>${icon('play')}</button>
        <section class="panel friend"><h3>PLAY A FRIEND</h3>
          <div class="chiprow"><span>Overs</span>${chips('friendOvers', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], friendly.overs)}</div>
          <div class="chiprow"><span>Ground</span>${chips('friendVenue', catalog.venues.map((v) => [v[0], v[1]]), friendly.venue)}</div>
          <button class="big primary" data-action="host">${icon('users')}<span><b>Create a match</b><small>You'll get a code to share</small></span></button>
          <div class="joinrow"><input id="joincode" maxlength="4" placeholder="CODE" aria-label="Match code" autocomplete="off" autocapitalize="characters" spellcheck="false">
            <button class="big" data-action="join"><b>Join</b></button></div>
        </section>
        <p class="note">${progress.online ? `${progress.onlineWon} won of ${progress.online} played online. ` : ''}Online matches connect your device straight to your opponent's.</p>`;
  }
  return `<div class="screen list online">${header('Play Online', 'Head to head, ball by ball.')}${body}</div>`;
}

function setLobby(stage, extra = {}) {
  Object.assign(lobby, { stage, message: '' }, extra);
  clearInterval(lobbyTimer);
  if (stage === 'searching') {
    lobby.since = performance.now();
    // The "nobody about" line appears after a while.
    lobbyTimer = setInterval(() => {
      if (screen === 'online' && lobby.stage === 'searching') render();
    }, 5000);
  }
  if (screen === 'online') render();
}

function connect(kind, code) {
  sound.unlock();
  hangUp();
  rematch.mine = rematch.theirs = false;
  lobby.kind = kind;
  const mine = new Link({
    status: (stage, detail) => {
      if (link !== mine) return;
      if (stage === 'hosting') setLobby('hosting', { code: detail });
      else if (stage === 'error') {
        link = null;
        setLobby('error', { message: detail });
      } else if (stage === 'searching' || stage === 'joining') setLobby(stage, { code: detail || '' });
    },
    open: (role) => {
      if (link !== mine) return;
      setLobby('starting');
      sound.play('star', 0.7);
      if (role === 'guest') mine.send({ app: 'hello', v: NET_VERSION, build: BUILD, team: me() });
    },
    message: (m) => {
      if (link === mine) onNetMessage(m);
    },
    close: () => {
      if (link !== mine) return;
      link = null;
      opponentGone();
    },
  });
  link = mine;
  if (kind === 'host') setLobby('opening');
  if (kind === 'host') mine.host();
  else if (kind === 'join') mine.join(code);
  else mine.quick();
}

function hangUp() {
  clearInterval(lobbyTimer);
  if (link) {
    const old = link;
    link = null;
    old.close();
  }
  lobby.stage = 'menu';
}

const MISMATCH = 'You and your opponent have different versions of Super Over. Both reload the page and try again.';

function onNetMessage(m) {
  if (m.g !== undefined) {
    if (netlog && !m.g.includes('"t":"time"')) console.log(`< ${m.g}`);
    if (screen === 'match' && lastMode === 'online') command({ cmd: 'net', msg: m.g });
    return;
  }
  switch (m.app) {
    case 'hello':
      if (link.role !== 'host') return;
      if (m.v !== NET_VERSION || (m.build !== BUILD && BUILD !== 'dev' && m.build !== 'dev')) {
        link.send({ app: 'old' });
        hangUp();
        return setLobby('error', { message: MISMATCH });
      }
      link.them = m.team;
      return kickOff(true);
    case 'old':
      hangUp();
      return setLobby('error', { message: MISMATCH });
    case 'start':
      if (link.role === 'guest') beginOnline(m.setup, 'away');
      return;
    case 'again':
      rematch.theirs = true;
      if (link.role === 'host' && rematch.mine) kickOff(false);
      else if (screen === 'match') renderMatch();
      return;
    case 'bye': {
      const old = link;
      link = null;
      old.shut();
      return opponentGone();
    }
  }
}

/// The host decides the match and tells the guest.
function kickOff(first) {
  const stadiums = ['grandArena', 'sandstoneArena', 'monsoonPark', 'harbourOval'];
  const anyone = lobby.kind === 'quick';
  // Two sides with the same name or letters would be one side on the scoreboard.
  const home = me(), away = { ...link.them };
  away.name = String(away.name || 'Visitors').slice(0, 22);
  away.short = String(away.short || 'VIS').slice(0, 3).toUpperCase();
  away.kit = Number(away.kit) || 0;
  if (away.name.toLowerCase() === home.name.toLowerCase()) away.name = `${away.name.slice(0, 19)} II`;
  if (away.short === home.short) away.short = `${away.short.slice(0, 2)}2`;
  const setup = {
    seed: Math.floor(Math.random() * 4294967295), overs: anyone ? 2 : friendly.overs, wickets: anyone ? 3 : friendly.wickets,
    venue: anyone ? stadiums[Math.floor(Math.random() * stadiums.length)] : friendly.venue,
    home, away, homeBatsFirst: first ? Math.random() < 0.5 : !link.homeBattedFirst,
  };
  link.homeBattedFirst = setup.homeBatsFirst;
  link.send({ app: 'start', setup });
  beginOnline(setup, 'home');
}

function beginOnline(setup, side) {
  rematch.mine = rematch.theirs = false;
  clearInterval(lobbyTimer);
  lastMode = 'online';
  recordedVersion = null;
  leaving = false;
  clearEffects();
  command({ cmd: 'online', setup: { ...setup, side } });
  screen = 'match';
  render();
}

function opponentGone() {
  if (screen === 'match' && lastMode === 'online') {
    command({ cmd: 'left' });
    renderMatch();
  } else if (screen === 'online' && lobby.stage !== 'menu') {
    setLobby('error', { message: 'The connection dropped. Try again.' });
  }
}

async function shareCode() {
  const url = joinURL(lobby.code);
  const text = `Play me at Super Over! Code ${lobby.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: 'Super Over', text, url });
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch { /* they changed their mind */ }
}

// MARK: The match.

function onState(next) {
  if (next.screen !== 'match') return;
  state = next;
  if (screen === 'match') renderMatch();
}

const moodClass = { six: 'six', four: 'four', out: 'out', great: 'great', info: 'great', quiet: 'quiet' };
const mark = (m) => {
  const cls = m === 'W' ? 'w' : m === '6' ? 's6' : m === '4' ? 's4' : m === '•' ? 'dot' : /wd|nb/.test(m) ? 'ex' : 'run';
  return `<span class="ball ${cls} ${m.length > 2 ? 'small' : ''}">${esc(m)}</span>`;
};
let shown = { runs: null, wickets: null, balls: '' };
/// The overlay on screen (so it only animates in when it first appears, not on every redraw).
let overlayShown = '';
let overlayFresh = true;

function renderMatch() {
  if (!state) {
    ui.innerHTML = '';
    return;
  }
  const s = state;
  const hudHidden = ['intro', 'toss', 'results'].includes(s.phase);
  const net = s.online;
  let html = '';
  if (!hudHidden) {
    const bumped = shown.runs !== null && (shown.runs !== s.runs || shown.wickets !== s.wickets);
    const chase = s.need ? esc(s.need) : (s.target ? `Target ${s.target}` : '');
    const ballsKey = `${s.batting}|${s.overs}|${s.thisOver.length}`;
    html += `<div class="bug" style="--kit:${s.battingShirt};--trim:${s.battingTrim}">
        <div class="line1"><span class="crest">${esc(s.batting)}</span><b class="score ${bumped ? 'bump' : ''}">${s.runs}-${s.wickets}</b>
          <span class="overs">${esc(s.overs)}${s.maxOvers ? `<i>/${s.maxOvers}</i>` : ''}</span><span class="grow"></span>
          ${s.superOver ? '<em class="tagged">SUPER OVER</em>' : ''}${chase ? `<span class="chase">${chase}</span>` : `<span class="chase dimmer">${esc(s.firstInnings || s.ground || '')}</span>`}</div>
        <div class="line2"><span class="on">${icon('bat')}${esc(s.striker?.name)} <b>${s.striker?.runs}</b><i>(${s.striker?.balls})</i></span>
          <span>${esc(s.nonStriker?.name)} <b>${s.nonStriker?.runs}</b><i>(${s.nonStriker?.balls})</i></span><span class="grow"></span>
          <span>${esc(s.bowler || '')} <b>${esc((s.bowlerFigures || '').split(' ')[0])}</b></span></div></div>
      <button class="round pausebtn" data-action="pause" aria-label="${net ? 'Leave' : 'Pause'}">${icon(net ? 'door' : 'pause')}</button>
      <div class="dock"><div class="overstrip ${ballsKey !== shown.balls && s.thisOver.length ? 'fresh' : ''}">${s.freeHit ? '<span class="freehit">FREE HIT</span>' : ''}${s.thisOver.slice(-6).map(mark).join('')}${'<span class="ball empty"></span>'.repeat(Math.max(0, 6 - s.thisOver.length))}</div>
        <div class="speed">${s.speed ? `<b>${s.speed}</b><small>KM/H</small>` : '<small>SPEED</small>'}</div></div>`;
    shown = { runs: s.runs, wickets: s.wickets, balls: ballsKey };
    if (s.phase === 'aiming' && !s.replaying && s.kinds.length) {
      html += `<div class="kinds">${s.kinds.map((k, i) => `<button class="${k.selected ? 'on' : ''}" data-kind="${i}"><b>${esc(k.title)}</b><small>${esc(k.detail)}</small></button>`).join('')}</div>`;
    }
    const timingHint = s.hint && /^(Timing|Perfect timing)/.test(s.hint) && s.shot;
    if (net?.wait && !s.paused) html += `<div class="hint wait ${s.kinds.length ? 'up' : ''}"><span class="dots"><i></i><i></i><i></i></span>${esc(net.wait)}</div>`;
    else if (s.hint && !timingHint) html += `<div class="hint ${s.phase === 'aiming' && s.kinds.length ? 'up' : ''}">${esc(s.hint)}</div>`;
    if (net) {
      html += `<div class="versus">${badge(net.opponentShort, net.opponentShirt, net.opponentTrim, 22)}<span>${esc(net.opponent)}</span></div>
        <div class="emotes">${['👏', '🔥', '😮', '😂'].map((e) => `<button data-emote="${e}">${e}</button>`).join('')}</div>`;
    }
  }
  const overlayNow = s.phase === 'results' ? 'results' : leaving ? 'leave' : s.paused ? 'pause' : s.phase === 'toss' ? `toss-${s.toss}`
    : ['intro', 'break', 'choosingBowler'].includes(s.phase) ? s.phase : '';
  overlayFresh = overlayNow !== overlayShown;
  overlayShown = overlayNow;
  if (s.phase === 'intro' && s.intro) html += introHTML(s.intro);
  if (s.phase === 'toss') html += tossHTML(s);
  if (s.phase === 'choosingBowler' && !s.paused && s.bowlers.length) html += bowlerHTML(s);
  if (s.phase === 'break' && s.breakInfo) html += breakHTML(s.breakInfo, net);
  if (s.paused) html += pauseHTML(s);
  if (leaving && s.phase !== 'results') html += leaveHTML();
  if (s.phase === 'results' && s.result) html += resultsHTML(s.result, s.version, net);
  ui.innerHTML = html;
  overlayFresh = true;
  effects(s, hudHidden);
}

function overlay(inner, extra = '') {
  return `<div class="overlay ${extra} ${overlayFresh ? '' : 'still'}"><div class="panel card">${inner}</div></div>`;
}

function introHTML(i) {
  const [shirt, trim] = myKit();
  return overlay(`<div class="row between"><b class="gold tag">STOP ${esc(i.id)}</b><span class="dim tag">${esc(i.ground.toUpperCase())}</span></div>
    <h1>${esc(i.title)}</h1><p class="dim">${esc(i.blurb)}</p>
    <div class="row">${badge(shortName(progress.team), shirt, trim, 40)}<span class="dim vs">VS</span>${badge(i.opponentShort, i.opponentShirt, i.opponentTrim, 40)}
      <div><b>${esc(i.opponent)}</b><br><small class="dim">${esc(i.format)}</small></div></div>
    <div class="objectives">${i.objectives.map((o, k) => `<div><span class="gold">${k < (progress.stars[i.id] || 0) ? '★' : '☆'}</span> ${esc(o)}</div>`).join('')}</div>
    <div class="row between"><span>${esc(i.difficulty)} · <span class="dim">${esc(i.tagline)}</span></span>${coins(i.reward)}</div>
    <div class="row"><button class="big quiet narrow" data-action="menu"><b>Back</b></button><button class="big primary" data-action="play">${icon('play')}<b>Play</b></button></div>`);
}

function tossHTML(s) {
  if (s.toss === 'call') {
    return overlay(`<b class="gold tag center">THE TOSS</b><div class="coin">H</div><h1 class="center">Call it</h1>
      <div class="row"><button class="big" data-toss="1"><b>Heads</b></button><button class="big" data-toss="0"><b>Tails</b></button></div>`);
  }
  if (s.toss === 'won') {
    return overlay(`<b class="gold tag center">THE TOSS</b><div class="coin flip">${s.tossCoin ? 'H' : 'T'}</div><h1 class="center lime">You won the toss</h1>
      <div class="row"><button class="big primary" data-innings="1"><b>Bat</b></button><button class="big" data-innings="0"><b>Bowl</b></button></div>`);
  }
  return overlay(`<b class="gold tag center">THE TOSS</b><div class="coin flip">${s.tossCoin ? 'H' : 'T'}</div><h1 class="center red">They won the toss</h1>
    <p class="center dim">…and chose to ${s.tossCPUBats ? 'bat. You\'re bowling.' : 'bowl. You\'re batting.'}</p>
    <button class="big primary" data-innings="${s.tossCPUBats ? 0 : 1}">${icon('play')}<b>Let's go</b></button>`);
}

function bowlerHTML(s) {
  return overlay(`<b class="gold tag">OVER ${Math.floor(parseFloat(s.overs)) + 1}</b><h1>Who bowls?</h1>
    ${s.bowlers.map((b) => `<button class="bowler" data-bowler="${b.index}"><span class="glyph">${icon(b.spin ? 'spin' : 'bolt')}</span>
      <span><b>${esc(b.name)}</b><small>${esc(b.style)} · ${esc(b.card)}</small></span><em>${b.rating}</em></button>`).join('')}
    <h3>FIELD</h3>${chips('field', [['attacking', 'Attacking'], ['balanced', 'Balanced'], ['defensive', 'Defensive']], selectedField)}`, 'sheet');
}

function breakHTML(b, net) {
  const waiting = net?.wait ? `<div class="waiting"><span class="dots"><i></i><i></i><i></i></span> ${esc(net.wait)}</div>` : '';
  const button = waiting || `<button class="big primary" data-action="continue">${icon('play')}<b>${net ? 'Ready' : 'Next innings'}</b></button>`;
  if (b.superOver) {
    return overlay(`<b class="gold tag center">SCORES LEVEL</b><h1 class="center">Super Over</h1><p class="center dim">${esc(b.line)}</p>${button}`);
  }
  return overlay(`<b class="gold tag center">INNINGS BREAK</b><h1 class="center huge">${esc(b.score)}</h1><p class="center dim">${esc(b.team)}${b.top ? ` · ${esc(b.top)}` : ''}</p>
    <h2 class="center gold">${esc(b.line)}</h2>${button}`);
}

function pauseHTML(s) {
  return overlay(`<h1 class="center">PAUSED</h1>
    <button class="big primary" data-action="resume">${icon('play')}<b>Resume</b></button>
    ${s.blitz || s.nets ? `<button class="big" data-action="stop">${icon('flag')}<b>${s.nets ? 'Finish session' : 'Retire'}</b></button>` : ''}
    <button class="big" data-action="restart">${icon('again')}<b>Restart</b></button>
    <button class="big" data-action="mute">${icon(sound.muted ? 'mute' : 'sound')}<b>Sound ${sound.muted ? 'off' : 'on'}</b></button>
    <button class="big" data-action="menu">${icon('home')}<b>Quit</b></button>`);
}

function leaveHTML() {
  return overlay(`<h1 class="center">Leave the match?</h1><p class="center dim">Your opponent wins if you go. The match carries on while you decide.</p>
    <button class="big primary" data-action="stay">${icon('play')}<b>Keep playing</b></button>
    <button class="big" data-action="mute">${icon(sound.muted ? 'mute' : 'sound')}<b>Sound ${sound.muted ? 'off' : 'on'}</b></button>
    <button class="big" data-action="menu">${icon('door')}<b>Leave</b></button>`);
}

function recordResult(r, version) {
  if (recordedVersion !== null) return;
  recordedVersion = version;
  progress.matches += 1;
  if (r.homeWon) progress.won += 1;
  progress.sixes += r.homeSixes;
  let earned = r.reward;
  if (r.mode === 'tour' && r.stopID) {
    const before = progress.stars[r.stopID] || 0;
    if ((r.stars || 0) > before) progress.stars[r.stopID] = r.stars;
    if (r.homeWon && !progress.wins.includes(r.stopID)) progress.wins.push(r.stopID);
    else if (r.homeWon) earned = Math.min(earned, 40 + r.homeSixes * 5);
  }
  if (r.mode === 'blitz') progress.blitzBest = Math.max(progress.blitzBest, r.homeRuns);
  if (r.mode === 'daily' && r.homeWon && !progress.dailyWins.includes(r.day)) progress.dailyWins.push(r.day);
  if (r.mode === 'online') {
    progress.online += 1;
    if (r.homeWon) progress.onlineWon += 1;
  }
  progress.coins += earned;
  r.earned = earned;
  save();
  sound.play('coin', 0.7);
}

function resultsHTML(r, version, net) {
  recordResult(r, version);
  const nextId = r.mode === 'tour' && r.homeWon ? catalog.stops[catalog.stops.findIndex((s) => s.id === r.stopID) + 1]?.id : null;
  let actions;
  if (r.mode === 'online') {
    const can = link && !net?.left;
    actions = `${can ? `<button class="big primary" data-action="again" ${rematch.mine ? 'disabled' : ''}>${icon('again')}<span><b>${rematch.mine ? 'Waiting for them…' : 'Rematch'}</b>${rematch.theirs && !rematch.mine ? '<small>They want another</small>' : ''}</span></button>` : '<p class="center dim">Your opponent has left.</p>'}
      <button class="big ${can ? '' : 'primary'}" data-action="menu">${icon('home')}<b>Menu</b></button>`;
  } else {
    actions = `${nextId ? `<button class="big primary" data-start='{"mode":"tour","stop":"${nextId}"}'>${icon('next')}<b>Next stop</b></button>` : ''}
      <button class="big ${nextId ? '' : 'primary'}" data-action="restart">${icon('again')}<b>${r.homeWon ? 'Play again' : 'Try again'}</b></button>
      <button class="big" data-action="menu">${icon('home')}<b>Menu</b></button>`;
  }
  return `<div class="overlay ${overlayFresh ? '' : 'still'}"><div class="panel card results ${r.won ? 'won' : ''}">
    <b class="tag center verdict ${r.won ? 'lime' : (r.headline === 'TIED' ? 'gold' : 'red')}">${esc(r.headline)}</b>
    <h1 class="center">${esc(r.winner)}</h1>${r.margin ? `<p class="center dim">${esc(r.margin)}</p>` : ''}
    ${r.stars !== null && r.stars !== undefined ? `<div class="center">${stars(r.stars, 'big')}</div>
      <div class="objectives">${r.objectives.map(([t, ok]) => `<div class="${ok === '1' ? 'lime' : 'dim'}">${ok === '1' ? '✓' : '○'} ${esc(t)}</div>`).join('')}</div>` : ''}
    ${r.earned ? `<div class="center earned">+ ${coins(r.earned)}</div>` : ''}
    ${r.potm ? `<p class="center"><span class="dim">Player of the match:</span> <b>${esc(r.potm)}</b></p>` : ''}
    ${r.cards.map((c) => `<div class="scorecard"><div class="row between">${badge(c.short, c.shirt, c.trim, 24)}<b class="grow">${esc(c.team)}${c.superOver ? ' · Super Over' : ''}</b><b class="total">${esc(c.score)}</b></div>
      ${c.batters.map((b) => `<div class="line"><span>${esc(b[0])}</span><small class="dim">${esc(b[1])}</small><span class="grow"></span><b>${esc(b[2])}</b><small class="dim">(${esc(b[3])})</small></div>`).join('')}
      ${c.bowlers.length ? `<div class="sep"></div>${c.bowlers.map((b) => `<div class="line dim"><span>${esc(b[0])}</span><span class="grow"></span><span>${esc(b[1])}</span></div>`).join('')}` : ''}</div>`).join('')}
    ${actions}</div></div>`;
}

// MARK: Moments: things that appear once, play out and go, so they live outside the scoreboard's redraws.

const seen = { callout: 0, shot: 0, emote: 0 };

function clearEffects() {
  fx.innerHTML = '';
  seen.callout = seen.shot = seen.emote = 0;
  shown = { runs: null, wickets: null, balls: '' };
  overlayShown = '';
  overlayFresh = true;
}

function moment(html, life) {
  const el = document.createElement('div');
  el.innerHTML = html;
  const node = el.firstElementChild;
  fx.appendChild(node);
  setTimeout(() => node.remove(), life);
  return node;
}

function toast(text) {
  moment(`<div class="toast">${esc(text)}</div>`, 1800);
}

function effects(s, hidden) {
  // REPLAY, top left, for as long as one is running.
  const badgeEl = fx.querySelector('.replay');
  if (s.replaying && !badgeEl) fx.insertAdjacentHTML('beforeend', '<div class="replay"><i></i>REPLAY <small>tap to skip</small></div>');
  else if (!s.replaying && badgeEl) badgeEl.remove();
  if (hidden) return;
  if (s.callout && s.callout.id !== seen.callout) {
    seen.callout = s.callout.id;
    fx.querySelectorAll('.callout').forEach((n) => n.remove());
    const mood = moodClass[s.callout.mood] || '';
    moment(`<div class="callout ${mood}"><h2>${esc(s.callout.headline)}</h2>${s.callout.detail ? `<p>${esc(s.callout.detail)}</p>` : ''}</div>`, mood === 'quiet' ? 1300 : 2300);
  }
  if (s.shot && s.shot.id !== seen.shot) {
    seen.shot = s.shot.id;
    fx.querySelectorAll('.timing').forEach((n) => n.remove());
    const names = { perfect: 'PERFECT!', good: 'GOOD', early: 'EARLY', late: 'LATE', veryEarly: 'TOO EARLY', veryLate: 'TOO LATE' };
    const at = 50 + Math.max(-1.15, Math.min(1.15, s.shot.offset)) * 40;
    moment(`<div class="timing ${s.shot.timing} ${s.shot.edged ? 'edged' : ''}"><div class="track"><i style="left:${at}%"></i></div>
      <div class="ends"><span>EARLY</span><b>${s.shot.edged ? 'EDGED' : names[s.shot.timing] || ''}</b><span>LATE</span></div></div>`, 1700);
  }
  const emote = s.online?.emote;
  if (emote && emote.id !== seen.emote) {
    seen.emote = emote.id;
    moment(`<div class="emote theirs">${badge(s.online.opponentShort, s.online.opponentShirt, s.online.opponentTrim, 26)}<span>${esc(emote.text)}</span></div>`, 2400);
    sound.play('tap', 0.5);
  }
}

// MARK: Buttons.

ui.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el || el.disabled) return;
  sound.unlock();
  sound.play('tap', 0.5);
  const d = el.dataset;
  if (d.go) return go(d.go);
  if (d.start) return start(JSON.parse(d.start));
  if (d.kind !== undefined) return command({ cmd: 'kind', index: Number(d.kind) });
  if (d.bowler !== undefined) return command({ cmd: 'bowler', index: Number(d.bowler), field: selectedField });
  if (d.toss !== undefined) return command({ cmd: 'toss', heads: d.toss === '1', coin: Math.random() < 0.5 });
  if (d.innings !== undefined) return command({ cmd: 'innings', bat: d.innings === '1' });
  if (d.emote) {
    command({ cmd: 'emote', text: d.emote });
    return moment(`<div class="emote mine"><span>${esc(d.emote)}</span></div>`, 1600);
  }
  if (d.set) {
    const value = d.value;
    if (['overs', 'wickets', 'difficulty', 'venue', 'opponent'].includes(d.set)) {
      quick[d.set] = ['overs', 'wickets'].includes(d.set) ? Number(value) : value;
      localStorage.setItem('superover.quick', JSON.stringify(quick));
    }
    if (d.set === 'superDifficulty') superDifficulty = value;
    if (d.set === 'netsBatting') nets.batting = value === '1';
    if (d.set === 'netsStyle') nets.style = value;
    if (d.set === 'netsDifficulty') nets.difficulty = value;
    if (d.set === 'friendOvers') friendly.overs = Number(value);
    if (d.set === 'friendVenue') friendly.venue = value;
    if (d.set.startsWith('friend')) localStorage.setItem('superover.friendly', JSON.stringify(friendly));
    if (d.set === 'kit') {
      keepName();
      progress.kit = Number(value);
      save();
      tellTeam();
    }
    if (d.set === 'field') {
      selectedField = value;
      return renderMatch();
    }
    return render();
  }
  switch (d.action) {
    case 'mute':
      sound.setMuted(!sound.muted);
      return render();
    case 'quickstart': return start({ mode: 'quick', ...quick });
    case 'superstart': return start({ mode: 'superover', difficulty: superDifficulty });
    case 'netsstart': return start({ mode: 'nets', ...nets });
    case 'play': return command({ cmd: 'play' });
    case 'continue': return command({ cmd: 'continue' });
    case 'pause':
      if (state?.online) {
        leaving = true;
        return renderMatch();
      }
      return command({ cmd: 'pause' });
    case 'stay':
      leaving = false;
      return renderMatch();
    case 'resume': return command({ cmd: 'resume' });
    case 'stop': return command({ cmd: 'stop' });
    case 'restart': return start(window.__lastStart);
    case 'find':
      keepName();
      return connect('quick');
    case 'host':
      keepName();
      return connect('host');
    case 'join': {
      keepName();
      const code = (document.getElementById('joincode')?.value || '').replace(/[^a-z]/gi, '').toUpperCase();
      if (code.length !== 4) return toast('Enter the four letters of the code');
      return connect('join', code);
    }
    case 'cancel-online':
    case 'online-menu':
      hangUp();
      return render();
    case 'share': return shareCode();
    case 'again':
      rematch.mine = true;
      link?.send({ app: 'again' });
      if (link?.role === 'host' && rematch.theirs) return kickOff(false);
      return renderMatch();
    case 'install': {
      const prompt = installPrompt;
      installPrompt = null;
      prompt?.prompt();
      return prompt?.userChoice.finally(render);
    }
    case 'install-apple':
      ui.insertAdjacentHTML('beforeend', appleInstallHTML());
      return;
    case 'close': return render();
    case 'menu':
      hangUp();
      leaving = false;
      lastMode = null;
      return go('home');
  }
});

/// The name you typed for your side, kept before the screen is redrawn.
function keepName() {
  const field = document.getElementById('teamname');
  if (!field) return;
  const name = field.value.replace(/\s+/g, ' ').trim().slice(0, 22);
  if (name && name !== progress.team) {
    progress.team = name;
    save();
    tellTeam();
  }
}
ui.addEventListener('change', (e) => {
  if (e.target.id === 'teamname') keepName();
});
ui.addEventListener('input', (e) => {
  if (e.target.id === 'joincode') e.target.value = e.target.value.replace(/[^a-z]/gi, '').toUpperCase();
});
ui.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'joincode') ui.querySelector('[data-action="join"]')?.click();
  if (e.key === 'Enter' && e.target.id === 'teamname') e.target.blur();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'match' && state && !state.online && !['results', 'intro', 'toss'].includes(state.phase)) command({ cmd: 'pause' });
});
window.addEventListener('pagehide', () => link?.close());

boot().catch((error) => {
  console.error(error);
  ui.innerHTML = `<div class="loading">${wordmark()}<p>Super Over couldn't start in this browser.<br><small>${esc(error.message)}</small></p></div>`;
});

// For automated checks.
window.__superOver = { command, get state() { return state; }, get screen() { return screen; }, go, start, connect, lobby,
  get link() { return link; }, get scene3d() { return scene3d; }, get frames() { return frames; },
  fps: () => new Promise((done) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else done(Math.round(n / 2)); }; requestAnimationFrame(tick); }) };
