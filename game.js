/* Gutter Run — Phase 0 prototype
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

const T = { hook: 1.0, oilFt: 40, bounce: 0.62, downSens: 1.0, speedMul: 1.0, guide: 1, lieR: 3.6 };
const TUNE_DEFS = [
  ['hook', 'Hook strength', 0, 2.5, 0.05],
  ['oilFt', 'Oil length (ft)', 30, 50, 1],
  ['bounce', 'Pin bounciness', 0.3, 0.9, 0.01],
  ['downSens', 'Pin-down sensitivity', 0.5, 2, 0.05],
  ['speedMul', 'Ball speed', 0.7, 1.4, 0.01],
  ['lieR', 'Fallen pin spread', 2.4, 5, 0.1],
  ['guide', 'Aim guide (0 off / 1 on)', 0, 1, 1],
];

const STATION = { target: 750, frames: 5, reracks: 2 };

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
  reracks: STATION.reracks,
  strikeStreak: 0,
  wasSplit: false,
  rollTime: 0,
  firstContact: false,
  timeScale: 1, slowmo: 0,
  stats: { strikes: 0, spares: 0, splits: 0, gutters: 0, best: 0 },
  lastThrow: null,
  aimX: 0,
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

function step(dt) {
  const oilZ = T.oilFt * 12;
  // ball
  if (ball.active && !ball.done) {
    const v = Math.hypot(ball.vx, ball.vz);
    if (!ball.gutter && v > 1) {
      const dry = ball.z > oilZ ? 1 : 0.1;
      const slowBoost = Math.max(0.75, Math.min(1.6, 300 / v));
      const a = 40 * T.hook * ball.spin * dry * slowBoost * (ball.z < L + 10 ? 1 : 0.3);
      // perpendicular-left of travel for positive spin (hook toward -x)
      ball.vx += (-ball.vz / v) * a * dt;
      ball.vz += (ball.vx / v) * a * dt * 0; // keep forward speed steady; lateral only
      const dec = 10 * dt;
      ball.vx -= (ball.vx / v) * dec; ball.vz -= (ball.vz / v) * dec;
    }
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
  const v = mph * MPH;
  ball.vx = v * Math.sin(ang); ball.vz = v * Math.cos(ang);
  ball.spin = spin; ball.active = true; ball.gutter = false; ball.done = false;
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
  const knocked = standingBefore.filter((n) => !now.includes(n)).length;
  const fresh = standingBefore.length === 10 && S.ballInFrame === 1;
  let title, bonus = 0, mult = 1, cls = '';
  let frameOver = false;
  if (S.ballInFrame === 1) {
    if (now.length === 0 && fresh) {
      S.strikeStreak++; S.stats.strikes++;
      if (S.strikeStreak >= 3) { title = 'TURKEY!'; bonus = 100; mult = 8; }
      else { title = 'STRIKE!'; bonus = 50; mult = 4; }
      frameOver = true;
    } else {
      S.strikeStreak = 0;
      const backDown = [7, 8, 9, 10].every((n) => !now.includes(n));
      S.wasSplit = isSplit(now);
      if (knocked === 0) { title = ball.gutter ? 'GUTTER' : 'MISS'; mult = ball.gutter ? 0 : 1; cls = 'red'; if (ball.gutter) S.stats.gutters++; }
      else if (backDown) { title = 'CLEAN BACK ROW'; bonus = 20; mult = 2; cls = 'small'; }
      else if (S.wasSplit) { title = 'SPLIT!'; cls = 'red'; S.stats.splits++; }
      else { title = `${knocked} PIN${knocked === 1 ? '' : 'S'}`; cls = 'small'; }
      S.ballInFrame = 2;
    }
  } else {
    if (now.length === 0) {
      if (S.wasSplit) { title = 'SPLIT PICKUP!'; bonus = 60; mult = 5; }
      else { title = 'SPARE!'; bonus = 30; mult = 3; }
      S.stats.spares++;
    } else if (knocked === 0) { title = ball.gutter ? 'GUTTER' : 'MISS'; mult = ball.gutter ? 0 : 1; cls = 'red'; if (ball.gutter) S.stats.gutters++; }
    else { title = `${knocked} PIN${knocked === 1 ? '' : 'S'}`; cls = 'small'; }
    S.strikeStreak = 0;
    frameOver = true;
  }
  const pinsVal = knocked * 10 + bonus;
  const total = pinsVal * mult;
  S.score += total;
  S.stats.best = Math.max(S.stats.best, total);
  showPopup(title, cls, pinsVal, mult, total);
  S.pendingFrameOver = frameOver;
  S.mode = 'result'; S.timer = 1.6;
}

function afterResult() {
  hidePopup();
  if (S.score >= STATION.target) return endStation(true);
  if (S.pendingFrameOver) {
    S.frame++;
    if (S.frame >= STATION.frames) return endStation(false);
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

function endStation(won) {
  S.mode = 'end';
  const left = STATION.frames - S.frame - (S.pendingFrameOver ? 1 : 0);
  $('endTitle').textContent = won ? 'Station Cleared' : 'Out of Frames';
  $('endTitle').classList.toggle('fail', !won);
  $('endScore').textContent = S.score.toLocaleString();
  $('endTarget').textContent = STATION.target.toLocaleString();
  const st = S.stats;
  $('endStats').innerHTML = [
    ['Strikes', st.strikes], ['Spares', st.spares], ['Splits', st.splits], ['Best roll', st.best.toLocaleString()],
    ...(won ? [['Frames left', Math.max(0, left)], ['Cash earned', '$' + (3 + Math.max(0, left))]] : []),
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('endOverlay').classList.remove('hidden');
  updateHUD();
}

function newStation() {
  Object.assign(S, { score: 0, shownScore: 0, frame: 0, ballInFrame: 1, reracks: STATION.reracks, strikeStreak: 0, wasSplit: false,
    stats: { strikes: 0, spares: 0, splits: 0, gutters: 0, best: 0 }, lastThrow: null });
  makeRack(); resetBall(); cam.z = 0;
  S.mode = 'aim';
  $('hint').textContent = 'Drag to move. Swipe up toward the arrows. Curve your swipe to hook.';
  updateHUD(); renderReadout();
}

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
  $('target').textContent = STATION.target.toLocaleString();
  $('frame').textContent = `${Math.min(S.frame + 1, STATION.frames)}/${STATION.frames}`;
  $('ballNo').textContent = S.ballInFrame;
  $('rerackCount').textContent = S.reracks;
  $('rerackBtn').disabled = !(S.mode === 'aim' && S.ballInFrame === 2 && S.reracks > 0);
  $('progress').style.width = Math.min(100, (S.score / STATION.target) * 100) + '%';
  const up = new Set(standing().map((p) => p.n));
  for (let n = 1; n <= 10; n++) pinMapEls[n].classList.toggle('down', !up.has(n));
}
function renderReadout() {
  const b = Math.round((LANE_HALF - S.aimX) / BOARD + 0.5);
  const t = S.lastThrow;
  $('readout').innerHTML = `Standing on <b>board ${b}</b>` + (t
    ? `<br>Last: <b>${t.mph} mph</b> · hook <b>${Math.abs(t.spin).toFixed(2)}${t.spin > 0.02 ? ' L' : t.spin < -0.02 ? ' R' : ''}</b><br>Board ${t.startBoard} → ${t.arrowBoard} at arrows`
    : '');
}
let popupT = null;
function showPopup(title, cls, pinsVal, mult, total) {
  const el = $('popupTitle');
  el.textContent = title; el.className = 'popup-title ' + cls;
  $('popupMath').innerHTML = `<span class="chip">${pinsVal}</span>×<span class="chip mult">${mult}</span>=<span class="chip total">${total.toLocaleString()}</span>`;
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
  let spin = (dev / len) * 4.5;
  if (Math.abs(spin) < 0.08) spin = 0;
  spin = Math.max(-1, Math.min(1, spin));
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

$('rerackBtn').addEventListener('click', () => {
  if (!(S.mode === 'aim' && S.ballInFrame === 2 && S.reracks > 0)) return;
  S.reracks--; S.ballInFrame = 1; S.wasSplit = false; makeRack(); updateHUD();
  $('hint').textContent = 'Fresh rack. This ball can still be a strike.';
});
$('startBtn').addEventListener('click', () => { initAudio(); $('startOverlay').classList.add('hidden'); newStation(); });
$('againBtn').addEventListener('click', () => { $('endOverlay').classList.add('hidden'); newStation(); });

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
  g.addColorStop(0, '#7fb6ff'); g.addColorStop(0.35, '#2459c4'); g.addColorStop(0.8, '#122c74'); g.addColorStop(1, '#081538');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, cy, r, 0, Math.PI * 2); ctx.fill();
  // swirl + finger holes rotate with roll
  ctx.save(); ctx.beginPath(); ctx.arc(p.x, cy, r, 0, Math.PI * 2); ctx.clip();
  const ph = ball.roll / (2 * Math.PI * ball.r) * Math.PI * 2;
  ctx.strokeStyle = 'rgba(160,120,255,.35)'; ctx.lineWidth = r * 0.18;
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
  if (S.mode === 'aim' && swipe && T.guide) {
    const r = analyzeSwipe(swipe);
    if (r) {
      let ang = Math.atan2(r.targetX - ball.x, ARROW_Z - ball.z);
      const maxA = 7 * Math.PI / 180; ang = Math.max(-maxA, Math.min(maxA, ang));
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,176,46,.85)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const z = ball.z + (L - ball.z) * i / 20; const p = proj(ball.x + Math.tan(ang) * (z - ball.z), z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
      ctx.stroke(); ctx.setLineDash([]);
      const ap = proj(ball.x + Math.tan(ang) * (ARROW_Z - ball.z), ARROW_Z);
      ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.arc(ap.x, ap.y, 5, 0, Math.PI * 2); ctx.fill();
      const last = swipe.pts[swipe.pts.length - 1];
      ctx.font = "600 14px 'Barlow Semi Condensed'"; ctx.textAlign = 'center'; ctx.fillStyle = '#f6ecdc';
      const hk = r.spin === 0 ? 'Straight' : `Hook ${Math.abs(r.spin).toFixed(2)} ${r.spin > 0 ? 'L' : 'R'}`;
      ctx.fillText(hk, last.x, last.y - 26);
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
  mode: S.mode, frame: S.frame + 1, ballInFrame: S.ballInFrame, score: S.score, target: STATION.target, reracks: S.reracks,
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

// ---------- Boot ----------
makeRack(); resetBall();
window.addEventListener('resize', layout);
layout();
if (document.fonts) document.fonts.ready.then(layout);
requestAnimationFrame(frame);
})();
