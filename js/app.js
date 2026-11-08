// Super Over in a browser: the game itself is the Swift engine compiled to WebAssembly
// (Packages/CricketKit, CricketWeb). This file runs it, draws its frames, passes it your touches
// and builds the menus and the HUD from the state it reports.
import { wasiImports } from './wasi.js?v=658010c48f';
import { drawList } from './renderer.js?v=658010c48f';
import { Sound } from './audio.js?v=658010c48f';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d', { alpha: false });
const ui = document.getElementById('ui');
const sound = new Sound();

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
let lastResult = null;
let lastMode = null;
let selectedField = 'balanced';
const down = new Set();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const today = Math.max(1, Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 86400000) + 1);

// MARK: Progress, kept in this browser.

const SAVE = 'superover.v1';
const progress = Object.assign({ coins: 300, stars: {}, wins: [], blitzBest: 0, dailyWins: [], matches: 0, won: 0, sixes: 0, team: 'Super Strikers', kit: 0 },
  JSON.parse(localStorage.getItem(SAVE) || '{}'));
const save = () => localStorage.setItem(SAVE, JSON.stringify(progress));
const totalStars = () => Object.values(progress.stars).reduce((a, b) => a + b, 0);
const stopUnlocked = (index) => index === 0 || progress.wins.includes(catalog.stops[index - 1].id);
const nextStop = () => catalog.stops.find((s, i) => !progress.wins.includes(s.id) && stopUnlocked(i)) || catalog.stops[catalog.stops.length - 1];

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

async function boot() {
  renderLoading(0);
  const response = await fetch('super-over.wasm?v=658010c48f');
  // The engine's size (web/deploy.sh stamps the real one): a compressed response's
  // content-length counts the compressed bytes, not the ones the reader hands over.
  const total = 13426613;
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
  command({ cmd: 'team', team: progress.team, short: shortName(progress.team), kit: progress.kit });
  resize();
  go('home');
  openLink();
  requestAnimationFrame(frame);
}

// Links straight into a mode: ?play=blitz (also quick, superover, friend, daily, nets, tour).
function openLink() {
  const play = new URLSearchParams(location.search).get('play');
  if (play === 'tour') return go('tour');
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

function frame(now) {
  const dt = lastTime ? (now - lastTime) / 1000 : 1 / 60;
  lastTime = now;
  const flags = x.so_frame(dt);
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
  if (flags & 4) {
    const pointer = x.so_text_ptr(), length = x.so_text_len();
    onState(JSON.parse(readText(pointer, length)));
  }
  if (flags & 8) {
    const pointer = x.so_cues_ptr(), length = x.so_cues_len();
    onCues(readText(pointer, length));
  }
  requestAnimationFrame(frame);
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
  for (const c of [canvas, bgCanvas]) {
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const insets = safeInsets();
  const landscape = width > height * 1.15;
  if (x) x.so_resize(width, height, insets.top + (landscape ? 70 : 104), insets.bottom + (landscape ? 70 : 132));
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

// MARK: Screens.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stars = (n, size = '') => `<span class="stars ${size}">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
const badge = (short, shirt, trim, size = 34) =>
  `<span class="badge" style="width:${size}px;height:${size}px;background:${shirt};border-color:${trim};color:${trim};font-size:${size * 0.3}px">${esc(short)}</span>`;
const coins = (n) => `<span class="coins"><b>C</b>${n}</span>`;
const wordmark = () => `<div class="wordmark"><div>SUPER</div><div class="row"><span class="ball"></span><span class="ver">VER</span></div></div>`;

function go(next) {
  screen = next;
  if (next !== 'match') state = null;
  if (['home', 'tour', 'quick', 'superover', 'nets'].includes(next) && lastMode !== 'demo') {
    command({ cmd: 'demo', seed: Date.now() % 100000 });
    lastMode = 'demo';
  }
  render();
}

function start(options) {
  sound.unlock();
  sound.play('tap', 0.6);
  lastMode = options.mode;
  lastResult = null;
  recordedVersion = null;
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
  }[screen];
  ui.innerHTML = `<div class="shade"></div>${typeof html === 'function' ? html() : html}`;
}

function renderLoading(fraction) {
  ui.innerHTML = `<div class="loading">${wordmark()}<div class="bar"><span style="width:${Math.round(fraction * 100)}%"></span></div>
    <p>Loading the ground…</p></div>`;
}

function homeHTML() {
  const next = nextStop();
  return `<div class="screen home">
    <header>${wordmark()}<div class="teamline">${badge(shortName(progress.team), '#1565C0', '#FFD54F', 24)} <span>${esc(progress.team)}</span> ${coins(progress.coins)}</div></header>
    <nav class="menu">
      <button class="big primary" data-go="tour"><span class="icon">🌏</span><span><b>World Tour</b><small>Next: ${next.id} ${esc(next.title)} · ${totalStars()}/90 ★</small></span></button>
      <div class="pair">
        <button class="big" data-go="quick"><span class="icon">⚡</span><span><b>Quick Match</b><small>Toss, bat, bowl</small></span></button>
        <button class="big" data-go="superover"><span class="icon">6️⃣</span><span><b>Super Over</b><small>CPU or a friend</small></span></button>
      </div>
      <div class="pair">
        <button class="big" data-start='{"mode":"blitz"}'><span class="icon">🔥</span><span><b>Blitz</b><small>Best ${progress.blitzBest}</small></span></button>
        <button class="big" data-start='{"mode":"daily","day":${today}}'><span class="icon">📅</span><span><b>Daily Chase</b><small>${progress.dailyWins.includes(today) ? 'Won today ✓' : esc(catalog.daily[0])}</small></span></button>
      </div>
      <div class="pair">
        <button class="big" data-go="nets"><span class="icon">🎯</span><span><b>Nets</b><small>Practice</small></span></button>
        <button class="big quiet" data-action="mute"><span class="icon">${sound.muted ? '🔇' : '🔊'}</span><span><b>Sound</b><small>${sound.muted ? 'Off' : 'On'}</small></span></button>
      </div>
      <p class="note">Swipe where you want the ball to go. Flick hard to loft it. Coming to the App Store for iPhone.</p>
    </nav></div>`;
}

function header(title, subtitle) {
  return `<div class="head"><button class="round" data-go="home" aria-label="Back">‹</button><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></div>`;
}

function tourHTML() {
  const legs = [];
  for (let i = 0; i < catalog.stops.length; i += 5) legs.push(catalog.stops.slice(i, i + 5).map((s, k) => [s, i + k]));
  return `<div class="screen list">${header('World Tour', `${totalStars()} of 90 stars`)}
    ${legs.map((leg) => {
      const first = leg[0][0];
      const open = stopUnlocked(leg[0][1]);
      return `<section class="panel leg ${open ? '' : 'locked'}"><div class="legtop"><div><h2>${esc(first.ground)}</h2><p>${esc(first.tagline)}</p></div>${badge(first.short, first.shirt, first.trim, 32)}</div>
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
    <button class="big primary" data-action="quickstart"><span class="icon">🪙</span><span><b>To the toss</b><small>${quick.overs} over${quick.overs > 1 ? 's' : ''} a side</small></span></button></div>`;
}

let superDifficulty = 'pro';
function superOverHTML() {
  return `<div class="screen list">${header('Super Over', 'One over each. Two wickets. Most runs wins.')}
    <h3>AGAINST THE GRAND ROYALS</h3>${chips('superDifficulty', catalog.difficulties.map((d) => [d[0], d[1], d[2]]), superDifficulty)}
    <button class="big primary" data-action="superstart"><span class="icon">🏏</span><span><b>Play the CPU</b><small>Under the lights at the Grand Arena</small></span></button>
    <h3>PASS AND PLAY</h3>
    <button class="big" data-start='{"mode":"superover","friend":true}'><span class="icon">👥</span><span><b>Play a friend</b><small>One of you bowls, the other bats</small></span></button></div>`;
}

const nets = { batting: true, style: 'fast', difficulty: 'pro' };
function netsHTML() {
  return `<div class="screen list">${header('Nets', 'No scoreboard pressure.')}
    ${chips('netsBatting', [['1', 'Batting', 'Face the bowler'], ['0', 'Bowling', 'Bowl at a batter']], nets.batting ? '1' : '0')}
    ${nets.batting ? `<h3>FACING</h3>${chips('netsStyle', [['fast', 'Fast'], ['swing', 'Swing'], ['offSpin', 'Off-spin'], ['legSpin', 'Leg-spin']], nets.style)}` : ''}
    <h3>DIFFICULTY</h3>${chips('netsDifficulty', catalog.difficulties.map((d) => [d[0], d[1]]), nets.difficulty)}
    <button class="big primary" data-action="netsstart"><span class="icon">🎯</span><span><b>Into the nets</b><small>Finish from the pause menu</small></span></button></div>`;
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

function renderMatch() {
  if (!state) {
    ui.innerHTML = '';
    return;
  }
  const s = state;
  const hudHidden = ['intro', 'toss', 'results'].includes(s.phase);
  let html = '';
  if (!hudHidden) {
    html += `<div class="scorebar" style="--kit:${s.battingShirt}">
      <div class="left">${badge(s.batting, s.battingShirt, s.battingTrim, 30)}<div><div class="score"><b>${s.runs}-${s.wickets}</b>
        <span>${esc(s.overs)}${s.maxOvers ? ` / ${s.maxOvers}` : ''}${s.nets ? '' : ' ov'}</span></div><small>${esc(s.firstInnings || s.title.toUpperCase())}</small></div></div>
      <div class="right">${s.superOver ? '<em>SUPER OVER</em>' : ''}${s.target ? `<em>TARGET ${s.target}</em>` : ''}${s.need ? `<span>${esc(s.need)}</span>` : ''}</div></div>
      <div class="info"><span>🏏 <b>${esc(s.striker?.name)} ${s.striker?.runs}*</b> (${s.striker?.balls})</span><span class="dim">${esc(s.nonStriker?.name)} ${s.nonStriker?.runs} (${s.nonStriker?.balls})</span>
        <span class="grow"></span><span class="dim">${esc(s.bowler || '')} ${esc(s.bowlerFigures || '')}</span></div>
      <div class="bottom"><button class="round pause" data-action="pause" aria-label="Pause">❚❚</button>
        <div class="overstrip">${s.freeHit ? '<span class="freehit">FREE HIT</span>' : ''}${s.thisOver.slice(-6).map(mark).join('')}${'<span class="ball empty"></span>'.repeat(Math.max(0, 6 - s.thisOver.length))}</div>
        <div class="speed">${s.speed ? `<b>${s.speed}</b><small>KM/H</small>` : '<small>SPEED</small>'}</div></div>`;
    if (s.phase === 'aiming' && !s.replaying) {
      html += `<div class="kinds">${s.kinds.map((k, i) => `<button class="${k.selected ? 'on' : ''}" data-kind="${i}"><b>${esc(k.title)}</b><small>${esc(k.detail)}</small></button>`).join('')}</div>`;
    }
    if (s.hint) html += `<div class="hint ${s.phase === 'aiming' ? 'up' : ''}">${esc(s.hint)}</div>`;
  }
  if (s.callout) {
    html += `<div class="callout ${moodClass[s.callout.mood] || ''}" key="${s.callout.id}"><h2>${esc(s.callout.headline)}</h2>${s.callout.detail ? `<p>${esc(s.callout.detail)}</p>` : ''}</div>`;
  }
  if (s.phase === 'intro' && s.intro) html += introHTML(s.intro);
  if (s.phase === 'toss') html += tossHTML(s);
  if (s.phase === 'choosingBowler' && !s.paused) html += bowlerHTML(s);
  if (s.phase === 'break' && s.breakInfo) html += breakHTML(s.breakInfo);
  if (s.paused) html += pauseHTML(s);
  if (s.phase === 'results' && s.result) html += resultsHTML(s.result, s.version);
  ui.innerHTML = html;
}

function overlay(inner) {
  return `<div class="overlay"><div class="panel card">${inner}</div></div>`;
}

function introHTML(i) {
  return overlay(`<div class="row between"><b class="gold tag">STOP ${esc(i.id)}</b><span class="dim tag">${esc(i.ground.toUpperCase())}</span></div>
    <h1>${esc(i.title)}</h1><p class="dim">${esc(i.blurb)}</p>
    <div class="row">${badge(shortName(progress.team), '#1565C0', '#FFD54F', 36)}<span class="dim">vs</span>${badge(i.opponentShort, i.opponentShirt, i.opponentTrim, 36)}
      <div><b>${esc(i.opponent)}</b><br><small class="dim">${esc(i.format)}</small></div></div>
    <div class="objectives">${i.objectives.map((o, k) => `<div><span class="gold">${k < (progress.stars[i.id] || 0) ? '★' : '☆'}</span> ${esc(o)}</div>`).join('')}</div>
    <div class="row between"><span>${esc(i.difficulty)} · <span class="dim">${esc(i.tagline)}</span></span>${coins(i.reward)}</div>
    <div class="row"><button class="big quiet narrow" data-action="menu"><b>Back</b></button><button class="big primary" data-action="play"><span class="icon">▶</span><b>Play</b></button></div>`);
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
    <button class="big primary" data-innings="${s.tossCPUBats ? 0 : 1}"><span class="icon">▶</span><b>Let's go</b></button>`);
}

function bowlerHTML(s) {
  return overlay(`<b class="gold tag">OVER ${Math.floor(parseFloat(s.overs)) + 1}</b><h1>Who bowls?</h1>
    ${s.bowlers.map((b) => `<button class="bowler" data-bowler="${b.index}"><span class="icon">${b.spin ? '🌀' : '⚡'}</span>
      <span><b>${esc(b.name)}</b><small>${esc(b.style)} · ${esc(b.card)}</small></span><em>${b.rating}</em></button>`).join('')}
    <h3>FIELD</h3>${chips('field', [['attacking', 'Attacking'], ['balanced', 'Balanced'], ['defensive', 'Defensive']], selectedField)}`);
}

function breakHTML(b) {
  if (b.superOver) {
    return overlay(`<b class="gold tag center">SCORES LEVEL</b><h1 class="center">Super Over</h1><p class="center dim">${esc(b.line)}</p>
      <button class="big primary" data-action="continue"><span class="icon">▶</span><b>Next innings</b></button>`);
  }
  return overlay(`<b class="gold tag center">INNINGS BREAK</b><h1 class="center">${esc(b.score)}</h1><p class="center dim">${esc(b.team)}${b.top ? ` · ${esc(b.top)}` : ''}</p>
    <h2 class="center gold">${esc(b.line)}</h2><button class="big primary" data-action="continue"><span class="icon">▶</span><b>Next innings</b></button>`);
}

function pauseHTML(s) {
  return overlay(`<h1 class="center">PAUSED</h1>
    <button class="big primary" data-action="resume"><span class="icon">▶</span><b>Resume</b></button>
    ${s.blitz || s.nets ? `<button class="big" data-action="stop"><span class="icon">🏁</span><b>${s.nets ? 'Finish session' : 'Retire'}</b></button>` : ''}
    <button class="big" data-action="restart"><span class="icon">↻</span><b>Restart</b></button>
    <button class="big" data-action="menu"><span class="icon">⌂</span><b>Quit</b></button>`);
}

function recordResult(r, version) {
  if (recordedVersion !== null) return;
  recordedVersion = version;
  lastResult = r;
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
  progress.coins += earned;
  r.earned = earned;
  save();
  sound.play('coin', 0.7);
}

function resultsHTML(r, version) {
  recordResult(r, version);
  const nextId = r.mode === 'tour' && r.homeWon ? catalog.stops[catalog.stops.findIndex((s) => s.id === r.stopID) + 1]?.id : null;
  return `<div class="overlay"><div class="panel card results">
    <b class="tag center ${r.won ? 'lime' : (r.headline === 'TIED' ? 'gold' : 'red')}">${esc(r.headline)}</b>
    <h1 class="center">${esc(r.winner)}</h1>${r.margin ? `<p class="center dim">${esc(r.margin)}</p>` : ''}
    ${r.stars !== null && r.stars !== undefined ? `<div class="center">${stars(r.stars, 'big')}</div>
      <div class="objectives">${r.objectives.map(([t, ok]) => `<div class="${ok === '1' ? 'lime' : 'dim'}">${ok === '1' ? '✓' : '○'} ${esc(t)}</div>`).join('')}</div>` : ''}
    ${r.earned ? `<div class="center">+ ${coins(r.earned)}</div>` : ''}
    ${r.potm ? `<p class="center"><span class="dim">Player of the match:</span> <b>${esc(r.potm)}</b></p>` : ''}
    ${r.cards.map((c) => `<div class="scorecard"><div class="row between">${badge(c.short, c.shirt, c.trim, 22)}<b class="grow">${esc(c.team)}${c.superOver ? ' · Super Over' : ''}</b><b>${esc(c.score)}</b></div>
      ${c.batters.map((b) => `<div class="line"><span>${esc(b[0])}</span><small class="dim">${esc(b[1])}</small><span class="grow"></span><b>${esc(b[2])}</b><small class="dim">(${esc(b[3])})</small></div>`).join('')}
      ${c.bowlers.length ? `<div class="sep"></div>${c.bowlers.map((b) => `<div class="line dim"><span>${esc(b[0])}</span><span class="grow"></span><span>${esc(b[1])}</span></div>`).join('')}` : ''}</div>`).join('')}
    ${nextId ? `<button class="big primary" data-start='{"mode":"tour","stop":"${nextId}"}'><span class="icon">⏭</span><b>Next stop</b></button>` : ''}
    <button class="big ${nextId ? '' : 'primary'}" data-action="restart"><span class="icon">↻</span><b>${r.homeWon ? 'Play again' : 'Try again'}</b></button>
    <button class="big" data-action="menu"><span class="icon">⌂</span><b>Menu</b></button></div></div>`;
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
    case 'pause': return command({ cmd: 'pause' });
    case 'resume': return command({ cmd: 'resume' });
    case 'stop': return command({ cmd: 'stop' });
    case 'restart': return start(window.__lastStart);
    case 'menu':
      lastMode = null;
      return go('home');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'match' && state && !['results', 'intro', 'toss'].includes(state.phase)) command({ cmd: 'pause' });
});

boot().catch((error) => {
  console.error(error);
  ui.innerHTML = `<div class="loading">${wordmark()}<p>Super Over couldn't start in this browser.<br><small>${esc(error.message)}</small></p></div>`;
});

// For automated checks.
window.__superOver = { command, get state() { return state; }, get screen() { return screen; }, go, start,
  fps: () => new Promise((done) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else done(Math.round(n / 2)); }; requestAnimationFrame(tick); }) };
