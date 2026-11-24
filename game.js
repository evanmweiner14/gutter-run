/* Gutter Run — Phase 1: Floor 1 run (3 stations, Pro Shop, charms, balls, boss lane)
   World units: inches. x = lateral (0 = lane center, + = right as seen by bowler).
   z = distance down the lane from the foul line (0) toward the pins (+). */
(() => {
'use strict';

// ---------- Constants ----------
const LANE_HALF = 20.75;           // 41.5" lane
const GUTTER_W = 9.25;
const EDGE = LANE_HALF + GUTTER_W; // kickback plane
const BOARD = 41.5 / 39;
const L = 720;                     // head pin (60 ft)
const ROW = 10.392;
const PIT = L + 3 * ROW + 6;       // end of pin deck
const BALL_R = 4.3, PIN_R = 2.4;
const BALL_M = 15, PIN_M = 3.5;
const SUB_DT = 1 / 240;
const MPH = 17.6;                  // in/s per mph
const ARROW_Z = 180;               // 15 ft

const PIN_SPOTS = [
  [0, 0], [-6, 1], [6, 1], [-12, 2], [0, 2], [12, 2], [-18, 3], [-6, 3], [6, 3], [18, 3],
].map(([x, r]) => ({ x, z: L + r * ROW }));

const T = { hook: 1.0, oilFt: 40, bounce: 0.62, downSens: 1.0, speedMul: 1.0, guide: 1, lieR: 3.6, swipeSpin: 0 };
const TUNE_DEFS = [
  ['hook', 'Hook strength', 0, 2.5, 0.05],
  ['oilFt', 'Oil length (ft)', 30, 50, 1],
  ['bounce', 'Pin bounciness', 0.3, 0.9, 0.01],
  ['downSens', 'Pin-down sensitivity', 0.5, 2, 0.05],
  ['speedMul', 'Ball speed', 0.7, 1.4, 0.01],
  ['lieR', 'Fallen pin spread', 2.4, 5, 0.1],
  ['guide', 'Aim guide (0 off / 1 on)', 0, 1, 1],
  ['swipeSpin', 'Swipe curve adds spin (0 off / 1 on)', 0, 1, 1],
];

// ---------- Run structure ----------
const RUN_FLOORS = 1;              // Phase 1 = one full floor; raise when more bosses exist
const STATIONS = [
  { key: 'open', name: 'Open Lane', tmult: 1, reward: 3 },
  { key: 'league', name: 'League Night', tmult: 1.35, reward: 4 },
  { key: 'boss', name: 'Boss Lane', tmult: 1.75, reward: 5 },
];
const BASE_TARGET = 900, FLOOR_GROWTH = 1.8;
const BASE_FRAMES = 5, BASE_RERACKS = 2, CHARM_SLOTS = 5, BAG_SLOTS = 3, START_CASH = 4, REROLL_BASE = 5;
function stationTarget(floor, idx) {
  return Math.round(BASE_TARGET * Math.pow(FLOOR_GROWTH, floor - 1) * STATIONS[idx].tmult / 50) * 50;
}

// ---------- Content (data-driven) ----------
const BALLS = {
  house: { id: 'house', name: 'House Ball', desc: 'Balanced and reliable.', mass: 15, hook: 1, price: 0,
    colors: ['#7fb6ff', '#2459c4', '#122c74', '#081538'], swirl: 'rgba(160,120,255,.35)' },
  resin: { id: 'resin', name: 'Reactive Resin', desc: 'Hooks 60% harder once it reaches the dry back end.', mass: 15, hook: 1.6, price: 6,
    colors: ['#ff9bf0', '#b02ab8', '#5c0f6b', '#2a0533'], swirl: 'rgba(255,200,120,.35)' },
  urethane: { id: 'urethane', name: 'Heavy Urethane', desc: 'Heavier, so it drives through the rack. Hooks a little less.', mass: 19, hook: 0.8, price: 6,
    colors: ['#ffc38a', '#d4541c', '#7a2108', '#3a0d02'], swirl: 'rgba(255,240,200,.3)' },
};

const BOSSES = [
  { id: 'tilt', name: 'The Tilt', desc: 'The lane slopes left. Every ball drifts toward the left gutter.', hint: 'The Tilt: the lane slopes left. Aim right.', tilt: -6 },
];

// Charms subscribe to events. score(c) gets the roll context { type, strike, streak, knocked, domino,
// lastFrame, pins, mult } and returns true when it changed something. stationStart(st) can edit { frames, reracks }.
const CHARMS = [
  { id: 'sock', name: 'Lucky Sock', icon: '🧦', price: 5, desc: 'Strikes give +4 Mult.',
    score(c) { if (c.strike) { c.mult += 4; return true; } } },
  { id: 'hot', name: 'Hot Hand', icon: '🔥', price: 6, desc: 'Strikes give +2 Mult for every strike in a row.',
    score(c) { if (c.strike) { c.mult += 2 * c.streak; return true; } } },
  { id: 'punk', name: 'Gutter Punk', icon: '🤘', price: 4, desc: 'Gutter balls score +20 Pins at ×2 Mult instead of nothing.',
    score(c) { if (c.type === 'gutter') { c.pins += 20; c.mult = 2; return true; } } },
  { id: 'savant', name: 'Seven-Ten Savant', icon: '🎯', price: 6, desc: 'Split pickups give ×2 Mult.',
    score(c) { if (c.type === 'split') { c.mult *= 2; return true; } } },
  { id: 'domino', name: 'Domino Effect', icon: '💥', price: 5, desc: '+5 Pins for each pin knocked down by another pin instead of the ball.',
    score(c) { if (c.domino > 0) { c.pins += 5 * c.domino; return true; } } },
  { id: 'lastcall', name: 'Last Call', icon: '🍺', price: 5, desc: 'Every roll in your final frame gets ×3 Mult.',
    score(c) { if (c.lastFrame && c.mult > 0) { c.mult *= 3; return true; } } },
  { id: 'shoes', name: 'Bowling Shoes', icon: '👟', price: 6, desc: '+1 frame at every station.',
    stationStart(st) { st.frames += 1; return true; } },
  { id: 'spare', name: 'Spare Parts', icon: '🔧', price: 4, desc: '+1 re-rack at every station.',
    stationStart(st) { st.reracks += 1; return true; } },
];
const charmById = (id) => CHARMS.find((c) => c.id === id);

// Run state (persists across stations)
const R = { floor: 1, station: 0, cash: START_CASH, charms: [], bag: ['house'], ballId: 'house', boss: null,
  rerollCost: REROLL_BASE, offers: [], cleared: [], totals: { score: 0, strikes: 0, spares: 0 } };
const curBall = () => BALLS[R.ballId];
function fire(event, ctx) {
  const fired = [];
  for (const id of R.charms) { const ch = charmById(id); if (ch[event] && ch[event](ctx)) fired.push(ch); }
  return fired;
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('lane');
const ctx = canvas.getContext('2d');
const app = $('app');

// ---------- State ----------
const S = {
  mode: 'menu',     // menu | aim | rolling | result | end
  timer: 0,
  score: 0, shownScore: 0,
  frame: 0, ballInFrame: 1,
  reracks: BASE_RERACKS, frames: BASE_FRAMES, target: BASE_TARGET,
  strikeStreak: 0,
  wasSplit: false,
  rollTime: 0,
  firstContact: false,
  timeScale: 1, slowmo: 0,
  stats: { strikes: 0, spares: 0, splits: 0, gutters: 0, best: 0 },
  lastThrow: null,
  aimX: 0,
  spin: 0,
  lastAng: 0,
};
const ball = { x: 0, z: 10, vx: 0, vz: 0, r: BALL_R, m: BALL_M, spin: 0, active: false, gutter: false, done: false, roll: 0 };
let pins = [];
const cam = { z: 0 };
let standingBefore = [];

function makeRack() {
  pins = PIN_SPOTS.map((p, i) => ({
    n: i + 1, x: p.x, z: p.z, sx: p.x, sz: p.z, vx: 0, vz: 0, r: PIN_R, m: PIN_M,
    alive: true, down: false, fallT: 0, fx: 0, fz: 1, wobble: 0, gutter: false, fade: 1,
  }));
}
const standing = () => pins.filter((p) => p.alive && !p.down);

// ---------- Layout / projection ----------
let W = 0, H = 0, DPR = 1, F = 1, D = 371, topY = 0, bottomY = 0, VIS = L + 70;
const PB = 0.55;
function layout() {
  const r = app.getBoundingClientRect();
  W = r.width; H = r.height; DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  const boardH = $('board').getBoundingClientRect().height;
  const ctrlH = $('controls').getBoundingClientRect().height;
  topY = boardH + Math.max(70, H * 0.1);
  bottomY = H - ctrlH - 26;
  $('readout').style.bottom = (ctrlH + 6) + 'px';
  $('tunePanel').style.bottom = (ctrlH + 6) + 'px';
  const nearFrac = 0.47;
  const farFrac = 0.16;
  D = L / (nearFrac / farFrac - 1);
  F = nearFrac * W * D / EDGE;
}
function proj(x, z) {
  let dz = z - cam.z + D;
  if (dz < 30) dz = 30;
  const s = F / dz;
  const p = (1 / D - 1 / dz) / (1 / D - 1 / (VIS + D));
  const q = (z - cam.z) / VIS;
  const f = PB * p + (1 - PB) * q;
  return { x: W / 2 + x * s, y: bottomY - f * (bottomY - topY), s };
}

// ---------- Audio ----------
let AC = null, rumbleGain = null, noiseBuf = null, lastClack = 0;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 1, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    rumbleGain = AC.createGain(); rumbleGain.gain.value = 0;
    src.connect(lp); lp.connect(rumbleGain); rumbleGain.connect(AC.destination); src.start();
  } catch (e) { AC = null; }
}
function clack(strength) {
  if (!AC || strength < 0.05) return;
  const now = AC.currentTime;
  if (now - lastClack < 0.012) return;
  lastClack = now;
  const g = AC.createGain();
  const v = Math.min(0.5, strength * 0.5);
  g.gain.setValueAtTime(v, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600 + Math.random() * 1800; bp.Q.value = 3;
  src.connect(bp); bp.connect(g);
  const o = AC.createOscillator(); o.frequency.value = 700 + Math.random() * 500;
  const og = AC.createGain(); og.gain.setValueAtTime(v * 0.6, now); og.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  o.connect(og); og.connect(AC.destination);
  g.connect(AC.destination);
  src.start(now, Math.random() * 0.5, 0.1); o.start(now); o.stop(now + 0.06);
}
function setRumble(v) { if (rumbleGain) rumbleGain.gain.setTargetAtTime(v, AC.currentTime, 0.05); }

// ---------- Physics ----------
function collide(a, b, e, isBallPin) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const rr = a.r + b.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  const pen = rr - d;
  if (isBallPin) b.ballHit = true;
  const ia = 1 / a.m, ib = 1 / b.m;
  a.x -= nx * pen * ia / (ia + ib); a.z -= nz * pen * ia / (ia + ib);
  b.x += nx * pen * ib / (ia + ib); b.z += nz * pen * ib / (ia + ib);
  const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rv >= 0) return;
  const j = -(1 + e) * rv / (ia + ib);
  a.vx -= j * ia * nx; a.vz -= j * ia * nz;
  b.vx += j * ib * nx; b.vz += j * ib * nz;
  const strength = -rv / 400;
  clack(strength);
  if (isBallPin && !S.firstContact) { S.firstContact = true; S.slowmo = 0.35; if (navigator.vibrate) navigator.vibrate(12); }
}

// Hook + lane friction for a rolling ball (shared by the sim and the aim preview)
function rollKinematics(b, dt, oilZ) {
  const v = Math.hypot(b.vx, b.vz);
  const dry = b.z > oilZ ? 1 : 0.1;
  const slowBoost = Math.max(0.75, Math.min(1.6, 300 / v));
  const a = 40 * T.hook * curBall().hook * b.spin * dry * slowBoost * (b.z < L + 10 ? 1 : 0.3);
  // positive spin pushes the ball toward -x (hooks left)
  b.vx += (-b.vz / v) * a * dt;
  if (R.boss && R.boss.tilt && b.z < L) b.vx += R.boss.tilt * dt;
  const dec = 10 * dt;
  b.vx -= (b.vx / v) * dec; b.vz -= (b.vz / v) * dec;
}
// Predicted path (no pins) for the aim guide
function predictPath(x, ang, mph, spin) {
  const v = mph * T.speedMul * MPH;
  const b = { x, z: ball.z, vx: v * Math.sin(ang), vz: v * Math.cos(ang), spin };
  const oilZ = T.oilFt * 12, dt = 1 / 120, pts = [[b.x, b.z]];
  for (let i = 0; i < 1200 && b.z < L; i++) {
    rollKinematics(b, dt, oilZ);
    b.x += b.vx * dt; b.z += b.vz * dt;
    if (i % 6 === 0) pts.push([b.x, b.z]);
    if (Math.abs(b.x) > LANE_HALF) { pts.push([b.x, b.z]); return { pts, gutter: true }; }
  }
  pts.push([b.x, b.z]);
  return { pts, gutter: false };
}

function step(dt) {
  const oilZ = T.oilFt * 12;
  // ball
  if (ball.active && !ball.done) {
    const v = Math.hypot(ball.vx, ball.vz);
    if (!ball.gutter && v > 1) rollKinematics(ball, dt, oilZ);
    ball.x += ball.vx * dt; ball.z += ball.vz * dt;
    ball.roll += v * dt;
    if (!ball.gutter && Math.abs(ball.x) > LANE_HALF && ball.z < PIT) {
      ball.gutter = true;
      ball.x = Math.sign(ball.x) * (LANE_HALF + GUTTER_W * 0.5);
      ball.vz = Math.hypot(ball.vx, ball.vz) * 0.95; ball.vx = 0;
    }
    if (ball.gutter) ball.x = Math.sign(ball.x) * (LANE_HALF + GUTTER_W * 0.5);
    if (ball.z > PIT + 8) { ball.done = true; }
    if (ball.vz < 5 && ball.z < PIT) { ball.done = true; }
  }
  // pins
  for (const p of pins) {
    if (!p.alive) continue;
    if (p.down && p.r < T.lieR) p.r = Math.min(T.lieR, p.r + dt * 20);
    const v = Math.hypot(p.vx, p.vz);
    if (v > 0) {
      const dec = (p.down ? 70 : 120) * dt + v * 1.1 * dt;
      const nv = Math.max(0, v - dec);
      p.vx *= nv / v; p.vz *= nv / v;
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (Math.abs(p.x) > EDGE - p.r) { p.x = Math.sign(p.x) * (EDGE - p.r); p.vx = -p.vx * 0.5; }
    if (Math.abs(p.x) > LANE_HALF + 0.6 && !p.gutter) { p.gutter = true; }
    if (p.z > PIT + p.r) { p.alive = false; p.down = true; }
    if (p.z < L - 60) { p.vz = Math.abs(p.vz) * 0.3; }
    // knock-down detection
    if (!p.down) {
      const disp = Math.hypot(p.x - p.sx, p.z - p.sz);
      const sp = Math.hypot(p.vx, p.vz);
      if (disp > 1.9 / T.downSens || sp > 24 / T.downSens || p.gutter) {
        p.down = true; p.fallT = 0;
        const dl = sp > 1 ? sp : Math.max(0.001, disp);
        p.fx = sp > 1 ? p.vx / dl : (p.x - p.sx) / dl; p.fz = sp > 1 ? p.vz / dl : (p.z - p.sz) / dl;
      } else if (sp > 1.5) {
        p.wobble = Math.min(1, p.wobble + sp * 0.01);
      }
    }
  }
  // collisions
  const bodies = pins.filter((p) => p.alive);
  if (ball.active && !ball.done && !ball.gutter) {
    for (const p of bodies) collide(ball, p, 0.5, true);
  }
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j], T.bounce, false);
}

// ---------- Throw ----------
function launch(targetX, mph, spin) {
  mph *= T.speedMul;
  let ang = Math.atan2(targetX - ball.x, ARROW_Z - ball.z);
  const maxA = 7 * Math.PI / 180;
  ang = Math.max(-maxA, Math.min(maxA, ang));
  S.lastAng = ang;
  const v = mph * MPH;
  ball.vx = v * Math.sin(ang); ball.vz = v * Math.cos(ang);
  ball.spin = spin; ball.active = true; ball.gutter = false; ball.done = false; ball.m = curBall().mass;
  for (const p of pins) p.ballHit = false;
  S.mode = 'rolling'; S.rollTime = 0; S.firstContact = false;
  standingBefore = standing().map((p) => p.n);
  const boardAt = (x) => Math.round((LANE_HALF - x) / BOARD + 0.5);
  const arrowX = ball.x + Math.tan(ang) * (ARROW_Z - ball.z);
  S.lastThrow = { mph: +mph.toFixed(1), spin: +spin.toFixed(2), startBoard: boardAt(ball.x), arrowBoard: boardAt(arrowX) };
  $('hint').textContent = '';
  renderReadout();
}

// ---------- Scoring ----------
function adjacent(a, b) {
  const A = PIN_SPOTS[a - 1], B = PIN_SPOTS[b - 1];
  return Math.hypot(A.x - B.x, A.z - B.z) < 12.6;
}
function isSplit(standNums) {
  if (standNums.includes(1) || standNums.length < 2) return false;
  const seen = new Set([standNums[0]]); const stack = [standNums[0]];
  while (stack.length) {
    const c = stack.pop();
    for (const o of standNums) if (!seen.has(o) && adjacent(c, o)) { seen.add(o); stack.push(o); }
  }
  return seen.size < standNums.length;
}

function evaluateRoll() {
  const now = standing().map((p) => p.n);
  const knockedNums = standingBefore.filter((n) => !now.includes(n));
  const knocked = knockedNums.length;
  const domino = pins.filter((p) => knockedNums.includes(p.n) && !p.ballHit).length;
  const fresh = standingBefore.length === 10 && S.ballInFrame === 1;
  let title, bonus = 0, mult = 1, cls = '', type = 'open';
  let frameOver = false;
  const missType = () => { type = ball.gutter ? 'gutter' : 'miss'; title = ball.gutter ? 'GUTTER' : 'MISS'; mult = ball.gutter ? 0 : 1; cls = 'red'; if (ball.gutter) S.stats.gutters++; };
  if (S.ballInFrame === 1) {
    if (now.length === 0 && fresh) {
      S.strikeStreak++; S.stats.strikes++;
      if (S.strikeStreak >= 3) { title = 'TURKEY!'; bonus = 100; mult = 8; type = 'turkey'; }
      else { title = 'STRIKE!'; bonus = 50; mult = 4; type = 'strike'; }
      frameOver = true;
    } else {
      S.strikeStreak = 0;
      const backDown = [7, 8, 9, 10].every((n) => !now.includes(n));
      S.wasSplit = isSplit(now);
      if (knocked === 0) missType();
      else if (backDown) { title = 'CLEAN BACK ROW'; bonus = 20; mult = 2; cls = 'small'; type = 'backrow'; }
      else if (S.wasSplit) { title = 'SPLIT!'; cls = 'red'; S.stats.splits++; }
      else { title = `${knocked} PIN${knocked === 1 ? '' : 'S'}`; cls = 'small'; }
      S.ballInFrame = 2;
    }
  } else {
    if (now.length === 0) {
      if (S.wasSplit) { title = 'SPLIT PICKUP!'; bonus = 60; mult = 5; type = 'split'; }
      else { title = 'SPARE!'; bonus = 30; mult = 3; type = 'spare'; }
      S.stats.spares++;
    } else if (knocked === 0) missType();
    else { title = `${knocked} PIN${knocked === 1 ? '' : 'S'}`; cls = 'small'; }
    S.strikeStreak = 0;
    frameOver = true;
  }
  const c = { type, strike: type === 'strike' || type === 'turkey', streak: S.strikeStreak, knocked, domino,
    lastFrame: S.frame === S.frames - 1, pins: knocked * 10 + bonus, mult };
  const fired = fire('score', c);
  const pinsVal = c.pins, total = Math.round(c.pins * c.mult);
  S.score += total;
  S.stats.best = Math.max(S.stats.best, total);
  showPopup(title, cls, pinsVal, +c.mult.toFixed(2), total, fired);
  S.pendingFrameOver = frameOver;
  S.mode = 'result'; S.timer = 1.6;
}

function afterResult() {
  hidePopup();
  if (S.score >= S.target) return endStation(true);
  if (S.pendingFrameOver) {
    S.frame++;
    if (S.frame >= S.frames) return endStation(false);
    S.ballInFrame = 1; S.wasSplit = false;
    makeRack();
  } else {
    // sweep fallen pins; standing pins stay where they are
    pins.forEach((p) => { if (p.down) p.alive = false; p.vx = p.vz = 0; p.sx = p.x; p.sz = p.z; p.wobble = 0; });
  }
  resetBall();
  S.mode = 'aim';
  $('hint').textContent = S.ballInFrame === 2 ? 'Pick up the spare. Re-rack resets to a full rack.' : 'Swipe up toward the arrows.';
  updateHUD();
}

let endAction = null;
function endStation(won) {
  S.mode = 'end';
  const left = Math.max(0, S.frames - S.frame - (S.pendingFrameOver ? 1 : 0));
  const st = S.stats, def = STATIONS[R.station];
  R.totals.score += S.score; R.totals.strikes += st.strikes; R.totals.spares += st.spares;
  const finalStation = R.station === STATIONS.length - 1 && R.floor >= RUN_FLOORS;
  let rows = [['Strikes', st.strikes], ['Spares', st.spares], ['Splits', st.splits], ['Best roll', st.best.toLocaleString()]];
  let cashHtml = '';
  if (won) {
    const interest = Math.min(5, Math.floor(R.cash / 5));
    const earned = def.reward + left + interest;
    cashHtml = `<div class="cash-lines">
      <div><span>${def.name} cleared</span><b>$${def.reward}</b></div>
      <div><span>Frames left (${left} × $1)</span><b>$${left}</b></div>
      <div><span>Interest ($1 per $5 held, max $5)</span><b>$${interest}</b></div>
      <div class="sum"><span>Cash</span><b>$${R.cash} → $${R.cash + earned}</b></div></div>`;
    R.cash += earned;
    R.cleared[R.station] = true;
  }
  if (won && finalStation) {
    $('endTitle').textContent = 'Run Complete!';
    rows = [['Run score', R.totals.score.toLocaleString()], ['Strikes', R.totals.strikes], ['Spares', R.totals.spares], ['Cash left', '$' + R.cash]];
    cashHtml = `<p class="end-note">You beat ${R.boss ? R.boss.name : 'the boss'} and cleared Floor ${R.floor}. More floors arrive in Phase 2.</p>`;
    $('againBtn').textContent = 'New Run'; endAction = startRun;
  } else if (won) {
    $('endTitle').textContent = R.station === STATIONS.length - 1 ? 'Boss Beaten!' : 'Station Cleared';
    $('againBtn').textContent = 'Pro Shop'; endAction = openShop;
  } else {
    $('endTitle').textContent = 'Run Over';
    rows = [['Reached', `Floor ${R.floor} · ${def.name}`], ['Run score', (R.totals.score).toLocaleString()], ['Strikes', R.totals.strikes], ['Spares', R.totals.spares]];
    cashHtml = `<p class="end-note">Out of frames, ${(S.target - S.score).toLocaleString()} short of the target.</p>`;
    $('againBtn').textContent = 'New Run'; endAction = startRun;
  }
  $('endTitle').classList.toggle('fail', !won);
  $('endScore').textContent = S.score.toLocaleString();
  $('endTarget').textContent = S.target.toLocaleString();
  $('endStats').innerHTML = rows.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('endCash').innerHTML = cashHtml;
  $('endOverlay').classList.remove('hidden');
  updateHUD();
}

function newStation() {
  const def = STATIONS[R.station];
  R.boss = def.key === 'boss' ? BOSSES[(R.floor - 1) % BOSSES.length] : null;
  const st = { frames: BASE_FRAMES, reracks: BASE_RERACKS };
  fire('stationStart', st);
  Object.assign(S, { score: 0, shownScore: 0, frame: 0, ballInFrame: 1, reracks: st.reracks, frames: st.frames,
    target: stationTarget(R.floor, R.station), strikeStreak: 0, wasSplit: false,
    stats: { strikes: 0, spares: 0, splits: 0, gutters: 0, best: 0 }, lastThrow: null });
  makeRack(); resetBall(); cam.z = 0;
  S.mode = 'aim';
  $('hint').textContent = R.boss ? R.boss.hint :'Pick a spin, drag to move, then swipe up toward the arrows.';
  updateHUD(); renderReadout();
}

// ---------- Run flow: start, floor map, Pro Shop ----------
function startRun() {
  Object.assign(R, { floor: 1, station: 0, cash: START_CASH, charms: [], bag: ['house'], ballId: 'house', boss: null,
    rerollCost: REROLL_BASE, offers: [], cleared: [], totals: { score: 0, strikes: 0, spares: 0 } });
  setBall('house');
  showMap();
}
function showMap() {
  S.mode = 'menu';
  R.boss = null;
  $('mapTitle').textContent = `Floor ${R.floor}`;
  $('mapList').innerHTML = STATIONS.map((d, i) => {
    const state = R.cleared[i] ? 'done' : i === R.station ? 'now' : 'later';
    const boss = d.key === 'boss' ? BOSSES[(R.floor - 1) % BOSSES.length] : null;
    return `<li class="${state}">
      <div class="map-top"><b>${d.name}</b><span>${state === 'done' ? 'Cleared' : 'Target ' + stationTarget(R.floor, i).toLocaleString()}</span></div>
      ${boss ? `<div class="map-boss"><b>${boss.name}.</b> ${boss.desc}</div>` : ''}
      <div class="map-sub">Reward $${d.reward} · +$1 per frame left</div></li>`;
  }).join('');
  $('mapOverlay').classList.remove('hidden');
  updateHUD();
}
function openShop() {
  S.mode = 'menu';
  R.rerollCost = REROLL_BASE;
  rollOffers(true);
  $('shopOverlay').classList.remove('hidden');
  renderShop();
}
function pickCharms(n) {
  const pool = CHARMS.filter((c) => !R.charms.includes(c.id));
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  return out;
}
function rollOffers(withBall) {
  const ballsLeft = Object.keys(BALLS).filter((id) => !R.bag.includes(id));
  const oldBall = R.offers.find((o) => o.kind === 'ball' && !o.sold);
  const ballOffer = withBall ? (ballsLeft.length ? { kind: 'ball', id: ballsLeft[Math.floor(Math.random() * ballsLeft.length)] } : null) : oldBall || null;
  const charmIds = pickCharms(ballOffer ? 2 : 3);
  R.offers = charmIds.map((id) => ({ kind: 'charm', id }));
  if (ballOffer) R.offers.push(ballOffer);
}
function offerInfo(o) {
  if (o.kind === 'charm') { const c = charmById(o.id); return { icon: c.icon, name: c.name, desc: c.desc, price: c.price, tag: 'Charm' }; }
  const b = BALLS[o.id]; return { icon: '', ball: b, name: b.name, desc: b.desc, price: b.price, tag: 'Ball' };
}
function renderShop() {
  $('shopCash').textContent = '$' + R.cash;
  $('shopOffers').innerHTML = R.offers.map((o, i) => {
    const f = offerInfo(o);
    const full = o.kind === 'charm' ? R.charms.length >= CHARM_SLOTS : R.bag.length >= BAG_SLOTS;
    const label = o.sold ? 'Sold' : full ? (o.kind === 'charm' ? 'Slots full' : 'Bag full') : `Buy $${f.price}`;
    const icon = f.ball ? `<i class="ball-dot" style="background:${ballGradient(f.ball)}"></i>` : `<i class="charm-icon">${f.icon}</i>`;
    return `<div class="offer${o.sold ? ' sold' : ''}">${icon}<div class="offer-text"><span class="eyebrow">${f.tag}</span><b>${f.name}</b><p>${f.desc}</p></div>
      <button class="btn small buy" data-i="${i}" type="button" ${o.sold || full || R.cash < f.price ? 'disabled' : ''}>${label}</button></div>`;
  }).join('') || '<p class="end-note">Sold out.</p>';
  $('shopOwned').innerHTML = R.charms.length
    ? R.charms.map((id) => { const c = charmById(id); return `<div class="owned"><i class="charm-icon">${c.icon}</i><div class="offer-text"><b>${c.name}</b><p>${c.desc}</p></div><button class="btn small sell" data-id="${id}" type="button">Sell $${sellPrice(c)}</button></div>`; }).join('')
    : '<p class="end-note">No charms yet. You have room for 5.</p>';
  $('rerollBtn').textContent = `Reroll $${R.rerollCost}`;
  $('rerollBtn').disabled = R.cash < R.rerollCost;
  updateHUD();
}
const sellPrice = (c) => Math.max(1, Math.floor(c.price / 2));
$('shopOffers').addEventListener('click', (e) => {
  const btn = e.target.closest('.buy'); if (!btn || btn.disabled) return;
  const o = R.offers[+btn.dataset.i], f = offerInfo(o);
  if (o.sold || R.cash < f.price) return;
  if (o.kind === 'charm') { if (R.charms.length >= CHARM_SLOTS) return; R.charms.push(o.id); }
  else { if (R.bag.length >= BAG_SLOTS) return; R.bag.push(o.id); setBall(o.id); }
  R.cash -= f.price; o.sold = true;
  renderShop();
});
$('shopOwned').addEventListener('click', (e) => {
  const btn = e.target.closest('.sell'); if (!btn) return;
  const c = charmById(btn.dataset.id);
  R.charms = R.charms.filter((id) => id !== c.id); R.cash += sellPrice(c);
  renderShop();
});
$('rerollBtn').addEventListener('click', () => {
  if (R.cash < R.rerollCost) return;
  R.cash -= R.rerollCost; R.rerollCost++;
  rollOffers(false);
  renderShop();
});
$('shopNext').addEventListener('click', () => {
  $('shopOverlay').classList.add('hidden');
  R.station++;
  if (R.station >= STATIONS.length) { R.station = 0; R.floor++; R.cleared = []; }
  showMap();
});
$('mapGo').addEventListener('click', () => { initAudio(); $('mapOverlay').classList.add('hidden'); newStation(); });

// ---------- Balls ----------
function ballGradient(b) { return `radial-gradient(circle at 35% 30%, ${b.colors[0]}, ${b.colors[1]} 55%, ${b.colors[3]})`; }
function setBall(id) {
  R.ballId = id;
  const b = curBall();
  $('knob').style.background = ballGradient(b);
  $('ballBtn').style.setProperty('--ball', ballGradient(b));
  $('ballBtn').setAttribute('aria-label', `Ball: ${b.name}. Tap to switch.`);
  renderReadout();
}
$('ballBtn').addEventListener('click', () => {
  if (S.mode !== 'aim') return;
  if (R.bag.length < 2) { $('hint').textContent = `${curBall().name}. Buy more balls in the Pro Shop.`; return; }
  const i = R.bag.indexOf(R.ballId);
  setBall(R.bag[(i + 1) % R.bag.length]);
  $('hint').textContent = `${curBall().name}: ${curBall().desc}`;
});

function resetBall() {
  Object.assign(ball, { z: 10, vx: 0, vz: 0, spin: 0, active: false, gutter: false, done: false });
  ball.x = S.aimX;
}

// ---------- HUD ----------
const pinMapEls = [];
(function buildPinMap() {
  const host = $('pinMap');
  const pos = { 7: [0, 0], 8: [1, 0], 9: [2, 0], 10: [3, 0], 4: [0.5, 1], 5: [1.5, 1], 6: [2.5, 1], 2: [1, 2], 3: [2, 2], 1: [1.5, 3] };
  for (let n = 1; n <= 10; n++) {
    const i = document.createElement('i');
    i.style.left = pos[n][0] * 20 + 'px'; i.style.top = pos[n][1] * 15 + 'px';
    host.appendChild(i); pinMapEls[n] = i;
  }
})();
function updateHUD() {
  const def = STATIONS[R.station];
  $('stationEyebrow').textContent = `Floor ${R.floor} · Station ${R.station + 1}` + (R.boss ? ` · ${R.boss.name}` : '');
  $('stationName').textContent = def.name;
  $('stationName').classList.toggle('boss', !!R.boss);
  $('target').textContent = S.target.toLocaleString();
  $('frame').textContent = `${Math.min(S.frame + 1, S.frames)}/${S.frames}`;
  $('ballNo').textContent = S.ballInFrame;
  $('rerackCount').textContent = S.reracks;
  $('rerackBtn').disabled = !(S.mode === 'aim' && S.ballInFrame === 2 && S.reracks > 0);
  $('ballBtn').disabled = S.mode !== 'aim';
  $('progress').style.width = Math.min(100, (S.score / S.target) * 100) + '%';
  const up = new Set(standing().map((p) => p.n));
  for (let n = 1; n <= 10; n++) pinMapEls[n].classList.toggle('down', !up.has(n));
  $('cash').textContent = '$' + R.cash;
  const slots = $('charmSlots');
  const key = R.charms.join(',');
  if (slots.dataset.key !== key) {
    slots.dataset.key = key;
    slots.innerHTML = Array.from({ length: CHARM_SLOTS }, (_, i) => {
      const c = charmById(R.charms[i]);
      return c ? `<button type="button" class="slot" data-id="${c.id}" aria-label="${c.name}: ${c.desc}">${c.icon}</button>` : '<span class="slot empty"></span>';
    }).join('');
  }
}
$('charmSlots').addEventListener('click', (e) => {
  const b = e.target.closest('.slot[data-id]'); if (!b) return;
  const c = charmById(b.dataset.id);
  $('hint').innerHTML = `<b>${c.name}</b>: ${c.desc}`;
});
function flashCharms(fired) {
  for (const ch of fired) {
    const el = document.querySelector(`.slot[data-id="${ch.id}"]`);
    if (!el) continue;
    el.classList.remove('fired'); void el.offsetWidth; el.classList.add('fired');
  }
}
function renderReadout() {
  const b = Math.round((LANE_HALF - S.aimX) / BOARD + 0.5);
  const t = S.lastThrow;
  $('readout').innerHTML = `${curBall().name} · <b>board ${b}</b>` + (t
    ? `<br>Last: <b>${t.mph} mph</b> · <b>${spinLabel(t.spin)}</b><br>Board ${t.startBoard} → ${t.arrowBoard} at arrows`
    : '');
}
let popupT = null;
function showPopup(title, cls, pinsVal, mult, total, fired = []) {
  const el = $('popupTitle');
  el.textContent = title; el.className = 'popup-title ' + cls;
  $('popupMath').innerHTML = `<span class="chip">${pinsVal}</span>×<span class="chip mult">${mult}</span>=<span class="chip total">${total.toLocaleString()}</span>`;
  $('popupCharms').innerHTML = fired.map((c) => `<span>${c.icon} ${c.name}</span>`).join('');
  flashCharms(fired);
  $('popup').classList.add('show');
}
function hidePopup() { $('popup').classList.remove('show'); }

// ---------- Input ----------
let swipe = null;
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (S.mode !== 'aim') return;
  canvas.setPointerCapture(e.pointerId);
  swipe = { pts: [{ x: e.offsetX, y: e.offsetY, t: performance.now() }] };
});
canvas.addEventListener('pointermove', (e) => {
  if (!swipe) return;
  swipe.pts.push({ x: e.offsetX, y: e.offsetY, t: performance.now() });
  if (swipe.pts.length > 200) swipe.pts.splice(1, 1);
});
canvas.addEventListener('pointerup', () => { if (swipe) { finishSwipe(swipe); swipe = null; } });
canvas.addEventListener('pointercancel', () => { swipe = null; });

function analyzeSwipe(sw) {
  const pts = sw.pts; if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const cx = b.x - a.x, cy = b.y - a.y;
  const len = Math.hypot(cx, cy);
  if (len < 45 || cy > -30) return null;
  const ux = cx / len, uy = cy / len;
  // curvature: max signed perpendicular deviation
  let dev = 0;
  for (const p of pts) {
    const c = ux * (p.y - a.y) - uy * (p.x - a.x);
    // c > 0 when the point lies right of the chord (screen). Bulge right => hook left (+spin)
    if (Math.abs(c) > Math.abs(dev)) dev = c;
  }
  let spin = S.spin;
  if (T.swipeSpin) {
    let sw = (dev / len) * 3;
    if (Math.abs(sw) < 0.12) sw = 0;
    spin = Math.max(-1, Math.min(1, spin + sw));
  }
  // speed over last 140ms
  const tEnd = b.t; let i = pts.length - 1;
  while (i > 0 && tEnd - pts[i - 1].t < 140) i--;
  const p0 = pts[Math.max(0, i - 1)];
  const dt = Math.max(16, tEnd - p0.t);
  const pxms = Math.hypot(b.x - p0.x, b.y - p0.y) / dt;
  const vN = pxms * 1000 / H;
  const mph = Math.max(9, Math.min(25, 9 + vN * 3.3));
  // aim: ray from ball screen position along chord, crossing the arrows
  const bp = proj(ball.x, ball.z);
  const ap = proj(0, ARROW_Z);
  const t = (ap.y - bp.y) / uy;
  const sx = bp.x + t * ux;
  const targetX = (sx - W / 2) / ap.s;
  return { targetX, mph, spin };
}
function finishSwipe(sw) {
  const r = analyzeSwipe(sw);
  if (!r) return;
  launch(r.targetX, r.mph, r.spin);
}

// position slider
const slider = $('slider');
let sliding = false;
function sliderSet(clientX) {
  const r = slider.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  S.aimX = (f - 0.5) * 2 * 18;
  if (S.mode === 'aim') ball.x = S.aimX;
  $('knob').style.left = (18 + f * (r.width - 36)) + 'px';
  slider.setAttribute('aria-valuenow', Math.round((LANE_HALF - S.aimX) / BOARD + 0.5));
  renderReadout();
}
slider.addEventListener('pointerdown', (e) => { initAudio(); if (S.mode !== 'aim') return; sliding = true; slider.setPointerCapture(e.pointerId); sliderSet(e.clientX); });
slider.addEventListener('pointermove', (e) => { if (sliding) sliderSet(e.clientX); });
slider.addEventListener('pointerup', () => { sliding = false; });
slider.addEventListener('keydown', (e) => {
  if (S.mode !== 'aim') return;
  const r = slider.getBoundingClientRect();
  const f = S.aimX / 36 + 0.5;
  if (e.key === 'ArrowLeft') sliderSet(r.left + (f - 0.03) * r.width);
  if (e.key === 'ArrowRight') sliderSet(r.left + (f + 0.03) * r.width);
});

// spin selector
const SPIN_STOPS = [0.9, 0.6, 0.3, 0, -0.3, -0.6, -0.9];
function spinLabel(v) {
  if (Math.abs(v) < 0.05) return 'Straight';
  const a = Math.abs(v), side = v > 0 ? 'left' : 'right';
  const size = a < 0.45 ? 'Light' : a < 0.75 ? 'Medium' : 'Big';
  return `${size} hook ${side}`;
}
function spinIcon(v) {
  // lane-view sketch of the ball path: rolls up, drifts out, then hooks back near the pins
  const k = -v; // screen x direction of the hook (left hook bends toward smaller x)
  const out = 12 - k * 3, end = 12 + k * 8;
  return `<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 25 C ${out} 15, ${out} 9, ${end} 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="${end}" cy="4" r="2.6" fill="currentColor"/><circle cx="12" cy="25" r="2" fill="currentColor" opacity=".55"/></svg>`;
}
(function buildSpin() {
  const host = $('spinRow');
  SPIN_STOPS.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'spin-btn'; b.innerHTML = spinIcon(v);
    b.setAttribute('aria-label', spinLabel(v)); b.dataset.v = v;
    b.addEventListener('click', () => setSpin(v));
    host.appendChild(b);
  });
})();
function setSpin(v) {
  S.spin = v;
  document.querySelectorAll('.spin-btn').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
  $('spinLabel').textContent = spinLabel(v);
}
setSpin(0);

$('rerackBtn').addEventListener('click', () => {
  if (!(S.mode === 'aim' && S.ballInFrame === 2 && S.reracks > 0)) return;
  S.reracks--; S.ballInFrame = 1; S.wasSplit = false; makeRack(); updateHUD();
  $('hint').textContent = 'Fresh rack. This ball can still be a strike.';
});
$('startBtn').addEventListener('click', () => { initAudio(); $('startOverlay').classList.add('hidden'); startRun(); });
$('againBtn').addEventListener('click', () => { $('endOverlay').classList.add('hidden'); (endAction || startRun)(); });

// tuning panel
(function buildTune() {
  const body = $('tuneBody');
  for (const [k, label, min, max, st] of TUNE_DEFS) {
    const l = document.createElement('label');
    l.innerHTML = `<span>${label}</span><output>${T[k]}</output><input type="range" min="${min}" max="${max}" step="${st}" value="${T[k]}">`;
    const inp = l.querySelector('input'), out = l.querySelector('output');
    inp.addEventListener('input', () => { T[k] = parseFloat(inp.value); out.textContent = T[k]; });
    body.appendChild(l);
  }
  $('tuneBtn').addEventListener('click', () => $('tunePanel').classList.toggle('hidden'));
  $('tuneClose').addEventListener('click', () => $('tunePanel').classList.add('hidden'));
  $('resetRackBtn').addEventListener('click', () => { if (S.mode !== 'aim') return; makeRack(); S.ballInFrame = 1; S.wasSplit = false; updateHUD(); });
})();

// ---------- Update ----------
function update(dt) {
  if (S.mode === 'rolling') {
    if (S.slowmo > 0) { S.slowmo -= dt; S.timeScale = 0.45; } else S.timeScale = 1;
    const simDt = dt * S.timeScale;
    let n = Math.max(1, Math.round(simDt / SUB_DT));
    for (let i = 0; i < n; i++) step(simDt / n);
    S.rollTime += simDt;
    const v = Math.hypot(ball.vx, ball.vz);
    setRumble(ball.active && !ball.done ? Math.min(0.35, v / 1400) * (ball.gutter ? 1.4 : 1) : 0);
    const moving = pins.some((p) => p.alive && Math.hypot(p.vx, p.vz) > 3);
    if ((ball.done && !moving && S.rollTime > 0.6) || S.rollTime > 7) {
      setRumble(0);
      for (const p of pins) { p.vx = p.vz = 0; }
      evaluateRoll(); updateHUD();
    }
  } else if (S.mode === 'result') {
    S.timer -= dt;
    if (S.timer < 0.5) pins.forEach((p) => { if (p.down) p.fade = Math.max(0, p.fade - dt * 2.5); });
    if (S.timer <= 0) afterResult();
  }
  for (const p of pins) { if (p.down) p.fallT += dt * S.timeScale; p.wobble *= Math.pow(0.08, dt); }
  // camera
  let target = 0;
  if (S.mode === 'rolling' || S.mode === 'result') target = Math.max(0, Math.min(L - 250, ball.z - 170));
  if (S.mode === 'result' && ball.done) target = cam.z;
  const k = S.mode === 'aim' || S.mode === 'menu' ? 4 : 6;
  cam.z += (target - cam.z) * Math.min(1, dt * k);
  // score count-up
  S.shownScore += (S.score - S.shownScore) * Math.min(1, dt * 6);
  if (Math.abs(S.score - S.shownScore) < 1) S.shownScore = S.score;
  $('score').textContent = Math.round(S.shownScore).toLocaleString();
}

// ---------- Rendering ----------
function strip(x0, x1, z0, z1, fill, n = 28) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; const p = proj(x0, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
  for (let i = n; i >= 0; i--) { const z = z0 + (z1 - z0) * i / n; const p = proj(x1, z); ctx.lineTo(p.x, p.y); }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
const PIN_PROFILE = [[0, .56], [.04, .66], [.14, .86], [.28, 1], [.4, .93], [.52, .64], [.6, .42], [.67, .38], [.76, .5], [.86, .56], [.94, .44], [.99, .16], [1, 0]];
function pinPath(len, w) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const [t, hw] of PIN_PROFILE) ctx.lineTo(hw * w / 2, -t * len);
  for (let i = PIN_PROFILE.length - 1; i >= 0; i--) { const [t, hw] = PIN_PROFILE[i]; ctx.lineTo(-hw * w / 2, -t * len); }
  ctx.closePath();
}
function drawPinShape(len, w) {
  pinPath(len, w);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, '#d8d0c4'); g.addColorStop(0.35, '#ffffff'); g.addColorStop(1, '#b9ad9e');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); pinPath(len, w); ctx.clip();
  ctx.fillStyle = '#d0352c';
  ctx.fillRect(-w, -0.635 * len, w * 2, 0.03 * len);
  ctx.fillRect(-w, -0.695 * len, w * 2, 0.03 * len);
  ctx.restore();
  ctx.lineWidth = Math.max(0.5, w * 0.04); ctx.strokeStyle = 'rgba(60,40,30,.35)';
  pinPath(len, w); ctx.stroke();
}
function drawPin(p) {
  const b = proj(p.x, p.z);
  const len = 15 * b.s * 0.92, w = 4.77 * b.s;
  ctx.save();
  ctx.globalAlpha = p.fade;
  // shadow
  ctx.fillStyle = 'rgba(40,20,5,.28)';
  ctx.beginPath(); ctx.ellipse(b.x + w * 0.2, b.y, w * 0.6, w * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(b.x, b.y);
  if (!p.down) {
    const tilt = Math.sin(performance.now() / 32) * p.wobble * 0.22;
    ctx.rotate(tilt);
    drawPinShape(len, w);
  } else {
    const h = proj(p.x + p.fx * 15, p.z + p.fz * 15);
    const vx = h.x - b.x, vy = h.y - b.y;
    let k = Math.min(1, p.fallT / 0.16); k = k * k * (3 - 2 * k);
    const ex = vx * k, ey = -len * (1 - k) + vy * k;
    const l = Math.max(w * 0.9, Math.hypot(ex, ey));
    ctx.rotate(Math.atan2(ex, -ey));
    drawPinShape(l, w);
  }
  ctx.restore();
}
function drawBall() {
  const p = proj(ball.x, ball.z);
  const r = ball.r * p.s;
  let cy = p.y - r * 0.92;
  if (ball.gutter) cy += r * 0.45;
  ctx.fillStyle = 'rgba(30,15,5,.35)';
  ctx.beginPath(); ctx.ellipse(p.x + r * 0.15, p.y, r * 0.95, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(p.x - r * 0.35, cy - r * 0.4, r * 0.1, p.x, cy, r);
  const bt = curBall();
  g.addColorStop(0, bt.colors[0]); g.addColorStop(0.35, bt.colors[1]); g.addColorStop(0.8, bt.colors[2]); g.addColorStop(1, bt.colors[3]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, cy, r, 0, Math.PI * 2); ctx.fill();
  // swirl + finger holes rotate with roll
  ctx.save(); ctx.beginPath(); ctx.arc(p.x, cy, r, 0, Math.PI * 2); ctx.clip();
  const ph = ball.roll / (2 * Math.PI * ball.r) * Math.PI * 2;
  ctx.strokeStyle = bt.swirl; ctx.lineWidth = r * 0.18;
  ctx.beginPath(); ctx.arc(p.x + Math.sin(ph * 0.5 + ball.spin) * r * 0.3, cy + Math.cos(ph) * r * 0.5, r * 0.7, 0.4, 2.6); ctx.stroke();
  const vis = Math.cos(ph);
  if (vis > -0.2) {
    const oy = cy - Math.sin(ph) * r * 0.55;
    ctx.fillStyle = 'rgba(5,8,20,.85)';
    const hr = r * 0.13 * (0.5 + 0.5 * Math.max(0, vis));
    for (const [dx, dy] of [[-0.22, 0], [0.22, 0], [0, 0.38]]) {
      ctx.beginPath(); ctx.ellipse(p.x + dx * r, oy + dy * r * vis, hr, hr * Math.max(0.3, vis), 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.ellipse(p.x - r * 0.38, cy - r * 0.45, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0807'); bg.addColorStop(1, '#1a110d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const z0 = Math.max(-90, cam.z - 120), zEnd = PIT + 40;
  // neighbor lanes (dim)
  for (const sgn of [-1, 1]) {
    const inner = EDGE + 3, outer = EDGE + 3 + 41.5;
    const xa = sgn < 0 ? -outer : inner, xb = sgn < 0 ? -inner : outer;
    strip(xa, xb, z0, PIT, '#6b4a2c');
    strip(xa, xb, z0, PIT, 'rgba(10,6,4,.62)');
    strip(sgn < 0 ? -(outer + GUTTER_W) : outer, sgn < 0 ? -outer : outer + GUTTER_W, z0, PIT, '#141416');
    // capping
    strip(sgn < 0 ? -(EDGE + 3) : EDGE, sgn < 0 ? -EDGE : EDGE + 3, z0, PIT + 20, '#2a1c14');
  }
  // gutters
  for (const sgn of [-1, 1]) {
    const xa = sgn < 0 ? -EDGE : LANE_HALF, xb = sgn < 0 ? -LANE_HALF : EDGE;
    strip(xa, xb, z0, PIT + 10, '#26262b');
    const mid = sgn * (LANE_HALF + GUTTER_W / 2);
    strip(mid - 2.2, mid + 2.2, z0, PIT + 10, '#1a1a1e');
  }
  // lane surface
  strip(-LANE_HALF, LANE_HALF, z0, PIT, '#d9a766');
  for (let b = 0; b < 39; b += 2) {
    const x0 = -LANE_HALF + b * BOARD;
    strip(x0, x0 + BOARD, z0, PIT, 'rgba(120,70,25,.10)', 18);
  }
  // board seams
  ctx.strokeStyle = 'rgba(110,65,25,.18)'; ctx.lineWidth = 0.6;
  for (let b = 1; b < 39; b++) {
    const x = -LANE_HALF + b * BOARD; const a = proj(x, z0), c = proj(x, PIT);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); for (let i = 1; i <= 12; i++) { const q = proj(x, z0 + (PIT - z0) * i / 12); ctx.lineTo(q.x, q.y); } ctx.stroke();
  }
  // approach (behind foul line)
  if (z0 < 0) strip(-LANE_HALF - GUTTER_W, LANE_HALF + GUTTER_W, z0, 0, '#c99657');
  // oil sheen
  const oilZ = T.oilFt * 12;
  const o0 = proj(0, Math.max(0, z0)).y, o1 = proj(0, oilZ).y;
  const og = ctx.createLinearGradient(0, o0, 0, o1);
  og.addColorStop(0, 'rgba(255,245,225,.16)'); og.addColorStop(0.75, 'rgba(255,245,225,.08)'); og.addColorStop(1, 'rgba(255,245,225,0)');
  strip(-LANE_HALF + 3, LANE_HALF - 3, Math.max(0, z0), oilZ, og);
  // light reflections
  for (const z of [160, 360, 560]) {
    if (z < z0) continue;
    strip(-6, 6, z, z + 70, 'rgba(255,250,235,.07)', 10);
  }
  // foul line
  if (z0 <= 0) strip(-EDGE, EDGE, -0.6, 0.6, '#1d120c', 2);
  // dots at 7ft
  ctx.fillStyle = 'rgba(40,20,10,.75)';
  for (const bd of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
    const x = LANE_HALF - (bd - 0.5) * BOARD; const p = proj(x, 84);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.55 * p.s, 0.35 * p.s, 0, 0, Math.PI * 2); ctx.fill();
  }
  // arrows
  for (const bd of [5, 10, 15, 20, 25, 30, 35]) {
    const x = LANE_HALF - (bd - 0.5) * BOARD; const k = Math.abs(bd - 20) / 5;
    const z = ARROW_Z - k * 12;
    const a = proj(x - 0.9, z), b = proj(x + 0.9, z), c = proj(x, z + 16);
    ctx.fillStyle = '#3a1f12';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.lineTo(b.x, b.y); ctx.closePath(); ctx.fill();
  }
  // boss: tilt chevrons painted on the lane, pointing downhill
  if (R.boss && R.boss.tilt) {
    const dir = Math.sign(R.boss.tilt);
    ctx.fillStyle = 'rgba(226,72,61,.28)';
    for (const z of [300, 420, 540, 640]) {
      if (z < z0) continue;
      for (const x0 of [-10, 2, 14]) {
        const tip = proj(x0 + dir * 4, z + 6), a = proj(x0 - dir * 2, z), b = proj(x0 - dir * 2, z + 12), m = proj(x0, z + 6);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(b.x, b.y); ctx.lineTo(m.x, m.y); ctx.closePath(); ctx.fill();
      }
    }
  }
  // pin deck
  strip(-LANE_HALF, LANE_HALF, L - 12, PIT, 'rgba(255,240,215,.18)', 6);
  ctx.fillStyle = 'rgba(70,40,20,.35)';
  for (const s of PIN_SPOTS) { const p = proj(s.x, s.z); ctx.beginPath(); ctx.ellipse(p.x, p.y, 1.2 * p.s, 0.5 * p.s, 0, 0, Math.PI * 2); ctx.fill(); }
  // pit
  strip(-EDGE - 3, EDGE + 3, PIT, zEnd, '#050303', 4);
  // kickbacks
  for (const sgn of [-1, 1]) {
    const x = sgn * EDGE;
    const a = proj(x, L - 30), b = proj(x, PIT + 30);
    const ha = 22 * a.s, hb = 22 * b.s;
    ctx.fillStyle = '#18100c';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - hb); ctx.lineTo(a.x, a.y - ha); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,176,46,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - ha * 0.6); ctx.lineTo(b.x, b.y - hb * 0.6); ctx.stroke();
  }
  // masking unit
  const m = proj(0, PIT + 34);
  const mw = (EDGE + 6) * m.s, mBot = m.y - 24 * m.s, mTop = m.y - 58 * m.s;
  ctx.fillStyle = '#050303'; ctx.fillRect(m.x - mw, mBot, mw * 2, m.y - mBot);
  const mg = ctx.createLinearGradient(0, mTop, 0, mBot);
  mg.addColorStop(0, '#7a1d18'); mg.addColorStop(1, '#4b0f0c');
  ctx.fillStyle = mg; ctx.fillRect(m.x - mw, mTop, mw * 2, mBot - mTop);
  ctx.fillStyle = '#ffb02e'; ctx.fillRect(m.x - mw, mBot - 2 * m.s, mw * 2, 1.6 * m.s);
  ctx.fillRect(m.x - mw, mTop, mw * 2, 1.6 * m.s);
  ctx.font = `${Math.round(13 * m.s)}px 'Bowlby One'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd27a'; ctx.fillText('GUTTER RUN', m.x, (mTop + mBot) / 2 + m.s);
  for (const sx of [-1, 1]) { ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.arc(m.x + sx * mw * 0.82, (mTop + mBot) / 2, 3.2 * m.s, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#0d0807'; ctx.fillRect(0, 0, W, Math.max(0, mTop));

  // aim guide
  if (S.mode === 'aim' && T.guide) {
    const r = swipe ? analyzeSwipe(swipe) : null;
    const maxA = 7 * Math.PI / 180;
    let ang = r ? Math.atan2(r.targetX - ball.x, ARROW_Z - ball.z) : S.lastAng;
    ang = Math.max(-maxA, Math.min(maxA, ang));
    const pred = predictPath(ball.x, ang, r ? r.mph : 17, r ? r.spin : S.spin);
    ctx.setLineDash([7, 6]); ctx.lineWidth = 2.5;
    ctx.strokeStyle = pred.gutter ? 'rgba(226,72,61,.9)' : r ? 'rgba(255,176,46,.95)' : 'rgba(255,176,46,.7)';
    ctx.beginPath();
    pred.pts.forEach(([x, z], i) => { const p = proj(x, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke(); ctx.setLineDash([]);
    if (r) {
      const ap = proj(ball.x + Math.tan(ang) * (ARROW_Z - ball.z), ARROW_Z);
      ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.arc(ap.x, ap.y, 5, 0, Math.PI * 2); ctx.fill();
      const last = swipe.pts[swipe.pts.length - 1];
      ctx.font = "600 14px 'Barlow Semi Condensed'"; ctx.textAlign = 'center'; ctx.fillStyle = '#f6ecdc';
      ctx.fillText(`${r.mph.toFixed(1)} mph · ${spinLabel(r.spin)}`, last.x, last.y - 26);
    }
  }
  if (swipe) {
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); swipe.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
  }

  // sprites, far to near
  const sprites = pins.filter((p) => p.alive && p.fade > 0).map((p) => ({ z: p.z, f: () => drawPin(p) }));
  if (S.mode !== 'menu') sprites.push({ z: ball.z + (ball.gutter ? -50 : 0), f: drawBall, ball: true });
  sprites.sort((a, b) => b.z - a.z);
  for (const s of sprites) {
    if (s.ball && ball.done && ball.z > PIT) continue;
    s.f();
  }
}

// ---------- Loop ----------
let last = performance.now(), manual = false;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (!manual) { update(dt); render(); }
  requestAnimationFrame(frame);
}

// ---------- Test hooks ----------
window.render_game_to_text = () => JSON.stringify({
  coords: 'inches; x=0 lane center, +x right; z=0 foul line, head pin z=720',
  mode: S.mode, frame: S.frame + 1, frames: S.frames, ballInFrame: S.ballInFrame, score: S.score, target: S.target, reracks: S.reracks,
  run: { floor: R.floor, station: STATIONS[R.station].name, cash: R.cash, charms: R.charms, bag: R.bag, ball: R.ballId, boss: R.boss && R.boss.id },
  ball: { x: +ball.x.toFixed(1), z: +ball.z.toFixed(1), gutter: ball.gutter, done: ball.done },
  standing: standing().map((p) => p.n), camZ: Math.round(cam.z), lastThrow: S.lastThrow,
});
window.advanceTime = (ms) => { manual = true; const n = Math.max(1, Math.round(ms / (1000 / 60))); for (let i = 0; i < n; i++) update(1 / 60); render(); manual = false; };
window.__throw = (x, targetX, mph, spin) => { S.aimX = x; ball.x = x; launch(targetX, mph, spin); };
window.__sim = (x, targetX, mph, spin) => {
  // headless roll on a fresh rack; returns pins left standing
  makeRack(); S.aimX = x; resetBall(); S.mode = 'aim'; S.ballInFrame = 1;
  launch(targetX, mph, spin);
  let t = 0, hitX = null, entry = null;
  while (t < 8) { const pz = ball.z, px = ball.x; step(SUB_DT); t += SUB_DT; if (hitX === null && pz < L - 8 && ball.z >= L - 8) { hitX = +ball.x.toFixed(1); entry = +(Math.atan2(ball.x - px, ball.z - pz) * 180 / Math.PI).toFixed(2); } const mv = pins.some((p) => p.alive && Math.hypot(p.vx, p.vz) > 3); if (ball.done && !mv && t > 0.6) break; }
  const left = standing().map((p) => p.n);
  const g = ball.gutter;
  S.mode = 'aim'; makeRack(); resetBall();
  return { left, gutter: g, hitX, entry };
};
window.__T = T;
window.__state = S;
window.__run = R;
// QA helpers: grant a charm / ball / cash without the shop
window.__give = (id) => { if (charmById(id) && !R.charms.includes(id)) R.charms.push(id); else if (BALLS[id] && !R.bag.includes(id)) { R.bag.push(id); setBall(id); } updateHUD(); };
window.__cash = (n) => { R.cash += n; updateHUD(); };

// ---------- Boot ----------
makeRack(); resetBall(); setBall('house'); updateHUD();
window.addEventListener('resize', layout);
layout();
if (document.fonts) document.fonts.ready.then(layout);
requestAnimationFrame(frame);
})();
