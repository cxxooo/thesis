// Palm Tree Pet — game logic (runs in the window's page)
// All positions are in SOURCE PIXELS (the 128x400 Aseprite canvas); the canvas is scaled up with CSS.

// ---------- config ----------
const VIEW_W = 280, VIEW_H = 340;       // visible area (must match main.js)
const OX = 16, OY = -30;                 // where the 128x400 art sits inside the view
const GROUND = 362;                      // trunk base (source y) = where feet stand
const LEAF_COUNT = 5;
const REGROW_MS = { fast: 60e3, normal: 10 * 60e3, slow: 60 * 60e3 };
const CLIMB_UP = 55, CLIMB_DOWN = 80, WALK = 22; // px per second
// Where each old leaf attaches (measured from your export)
const PIVOTS = [[52, 106], [65, 108], [49, 97], [66, 94], [56, 94]];

// ---------- platform bridge (stub lets it run in a normal browser for testing) ----------
const bridge = window.pet || {
  setClickThrough() {}, dragStart() {}, dragMove() {}, dragEnd() {}, track() {},
  loadState: async () => null, saveState() {}, onCommand() {},
  asset: async (n) => `../assets/${n}.png`,
  font: async () => '../assets/fonts/pixelify-sans-600.woff2',
};

// ---------- canvas ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W; canvas.height = VIEW_H;
let scale = 2;
function applyScale(s) {
  scale = s;
  canvas.style.width = VIEW_W * s + 'px';
  canvas.style.height = VIEW_H * s + 'px';
  if (onbReady) layoutOnboarding();
}
let onbReady = false;
applyScale(2);

// ---------- assets ----------
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function alphaOf(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const a = new Uint8Array(img.width * img.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}
function bboxOf(a, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x]) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
function cropCanvas(img, b) {
  const c = document.createElement('canvas'); c.width = b.x1 - b.x0 + 1; c.height = b.y1 - b.y0 + 1;
  c.getContext('2d').drawImage(img, -b.x0, -b.y0);
  return c;
}

const A = {}; // images + alpha maps
let trunkC = [];  // trunk center x for each source row

// ---------- game state ----------
const leaves = [];     // {state:'on'|'targeted'|'gone'|'growing', cutAt, grow}
const falling = [];    // falling leaf pieces
const particles = [];
let queue = [];        // leaf indices waiting to be cut
let regrowSpeed = 'normal';
let soundOn = true;
let treesTrimmed = 0;  // how many times the whole tree got trimmed -> colors palms in the Collection
let shakeT = 0;
let hover = null;      // what the mouse is over
let dragging = false;
let clickThrough = true;

// ---------- coconuts (just-for-fun: click where old leaves used to be once they're trimmed) ----------
// 3 coconuts hang on the tree. Each click knocks the next one down (0 -> 1 -> 2 -> 0 ...).
// A fallen coconut regrows quickly, so there is always another one to knock down. Infinite!
const COCO_COUNT = 3;
const COCO_REGROW_DELAY = 0.6;   // seconds before a fallen coconut starts growing back
const COCO_GROW_TIME = 0.9;      // seconds to grow back in
const COCO_GRAVITY = 260;        // px per second^2 (heavier than a leaf)
const COCO_MAX_GROUND = 12;      // more than this on the ground -> the oldest ones fade away
const COCO_REST = 8;             // seconds a coconut stays on the ground before fading
const coconuts = [];             // {state:'on'|'gone'|'growing', t, grow}
const cocoFalling = [];          // coconuts falling / bouncing / resting on the ground
let cocoNext = 0;                // which coconut drops next
const cocoPlay = { clicks: 0, drops: 0, start: 0, timer: null }; // one analytics row per burst of clicks

// ---------- worker (your Aseprite frames, drawn on the same 128x400 canvas as the tree) ----------
const W_FRAMES = ['walk1', 'walk2', 'walk3', 'walk4', 'idle', 'turn1', 'turn2', 'turn3', 'climb',
  'climb-side-view1', 'climb-side-view2', 'bucket-truck'];
// 3 ways to get up the tree. One is picked at random each time the worker comes (never the same twice in a row).
//   back   : walk in -> idle -> turn -> climb.png up the trunk
//   side   : walk in -> straight onto the trunk -> climb-side-view1/2
//   bucket : bucket truck boom telescopes in from the bottom-left, worker already in the bucket
const METHODS = ['back', 'side', 'bucket'];
let forcedMethod = null;              // set from the menu bar (Worker method) for testing
const BUCKET_TIME = 2.2;              // seconds for the boom to extend / retract
const BUCKET_TRAVEL = 125;            // how far (art px, along x) the boom pulls the bucket out of view
const BOOM_STEP = [17, 11];           // your boom repeats every 17px across / 11px down
let BUCKET = null;                    // bucket image with the boom extended off-canvas
const SPR = {};                       // name -> { crop, x0, y0, w, h, hc (helmet center x) }
const WALK_SPEED = 36;                // px per second
const CLIMB_UP_SPEED = 45, CLIMB_DOWN_SPEED = 70;
const WALK_FPS = 6, TURN_STEP = 0.14, ARRIVE_IDLE = 0.4, CUT_TIME = 0.9, LEAVE_IDLE = 0.5;
const BODY_Y = 330;                   // row used to follow the trunk's lean while climbing
let STOP_X = 50, START_X = -42, CLIMB_X = 64, SIDE_X = 50;
const worker = { state: 'away', x: -42, dy: 0, t: 0, target: -1, climbed: 0, method: 'back', last: null, p: 0 };

function setW(state) {
  worker.state = state; worker.t = 0;
  if (state === 'turnOut' || state === 'arrive') worker.x = STOP_X;
}
function drawSprite(name, x, dy, flip) {
  const s = SPR[name];
  const left = flip ? x - (s.w - (s.hc - s.x0)) : x - (s.hc - s.x0);
  const px = Math.round(left + OX), py = Math.round(s.y0 + dy + OY);
  if (!flip) ctx.drawImage(s.crop, px, py);
  else { ctx.save(); ctx.translate(px + s.w, py); ctx.scale(-1, 1); ctx.drawImage(s.crop, 0, 0); ctx.restore(); }
}
function climbX(dy) { return (worker.method === 'side' ? SIDE_X : CLIMB_X) + trunkX(BODY_Y + dy) - trunkX(BODY_Y); }
// how far up to climb so the helmet reaches just under leaf i
function targetDy(i) { return A.leaf[i].b.y1 - 4 - SPR[worker.method === 'side' ? 'climb-side-view1' : 'climb'].y0; }
function pickMethod() {
  if (forcedMethod) return forcedMethod;
  const options = METHODS.filter((m) => m !== worker.last);
  return options[Math.floor(Math.random() * options.length)];
}
const ease = (p) => p * p * (3 - 2 * p);
function nextTarget() {
  queue = queue.filter((i) => leaves[i].state === 'targeted');
  return queue.length ? queue[0] : -1;
}

// ---------- sound (tiny synth, no files needed) ----------
let ac = null;
function audio() { if (!ac) try { ac = new AudioContext(); } catch { } return ac; }
function noiseBurst(t0, dur, freq, gain) {
  const a = audio(); if (!a) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.5;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination); src.start(a.currentTime + t0);
}
function tone(t0, freq, dur, gain, type = 'triangle') {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = a.createGain(); const now = a.currentTime + t0;
  g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  o.connect(g).connect(a.destination); o.start(now); o.stop(now + dur);
}
const sfx = {
  snip() { if (!soundOn) return; noiseBurst(0, 0.05, 4000, 0.5); noiseBurst(0.07, 0.05, 5000, 0.4); },
  thud() { if (!soundOn) return; tone(0, 110, 0.15, 0.25, 'sine'); noiseBurst(0, 0.08, 600, 0.15); },
  click() { if (!soundOn) return; tone(0, 880, 0.06, 0.08, 'square'); },
  bonk(power = 1) { // hollow coconut knock, a little different every time
    if (!soundOn) return; const p = 0.85 + Math.random() * 0.3;
    tone(0, 260 * p, 0.14, 0.22 * power, 'sine'); tone(0, 520 * p, 0.05, 0.06 * power, 'triangle'); noiseBurst(0, 0.05, 900, 0.12 * power);
  },
  rustle() { if (!soundOn) return; noiseBurst(0, 0.14, 2500 + Math.random() * 800, 0.12); },
  yay() { if (!soundOn) return; [523, 659, 784, 1046].forEach((f, i) => tone(i * 0.09, f, 0.25, 0.12)); },
};

// ---------- helpers ----------
const leafVisible = (i) => leaves[i].state !== 'gone';
const allTrimmed = () => leaves.every((l) => l.state === 'gone');
function trunkX(y) { return trunkC[Math.max(0, Math.min(399, Math.round(y)))] || 58; }

function hitTest(sx, sy) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (onb.active && sx >= ONB.x - 4 && sx < ONB.x + ONB.w + 4 && sy >= ONB.y - 6 && sy < ONB.y + ONB.h) return { type: 'text' };
  if (sx < 0 || sy < 0 || sx >= 128 || sy >= 400) return null;
  const k = sy * 128 + sx;
  if (A.front.a[k]) return { type: 'tree' };
  for (let i = LEAF_COUNT - 1; i >= 0; i--) if (leafVisible(i) && A.leaf[i].a[k]) return { type: 'leaf', i };
  // no old leaf here any more (trimmed) -> this spot knocks coconuts down
  for (let i = 0; i < LEAF_COUNT; i++) if (!leafVisible(i) && A.leaf[i].a[k]) return { type: 'coconut' };
  for (let i = 0; i < COCO_COUNT; i++) if (coconuts[i].state !== 'gone' && A.coco[i].a[k]) return { type: 'coconut' };
  if (A.tree.a[k]) return { type: 'tree' };
  return null;
}

function save() {
  bridge.saveState({
    leaves: leaves.map((l) => ({ state: l.state === 'gone' ? 'gone' : 'on', cutAt: l.cutAt || 0, availableAt: l.availableAt || 0 })),
    regrowSpeed, sound: soundOn, onboarded: !onb.active && onb.done, treesTrimmed,
  });
}

// ---------- actions ----------
function requestCut(i) {
  const l = leaves[i];
  if (l.state !== 'on') return;
  l.state = 'targeted';
  queue.push(i);
  sfx.click();
  bridge.track('leaf_click', { leaf: i + 1, queued: queue.length, onboarding: onb.active ? onb.i + 1 : 0 });
  if (onb.active && onb.i === 3) finishOnboarding('leaf_click'); // last card: clicking a leaf also closes it
}

function cutLeaf(i) {
  const l = leaves[i];
  // minutes this old leaf was hanging there (since app start / since it grew back) before being cut
  const waitedMin = l.availableAt ? Math.round(((Date.now() - l.availableAt) / 60000) * 10) / 10 : null;
  l.state = 'gone'; l.cutAt = Date.now();
  queue = queue.filter((q) => q !== i);
  bridge.track('trim', { leaf: i + 1, method: worker.method, waitedMin, queueLeft: queue.length, allTrimmed: allTrimmed() });
  const L = A.leaf[i];
  falling.push({
    img: L.crop, px: PIVOTS[i][0] - L.b.x0, py: PIVOTS[i][1] - L.b.y0,
    x: PIVOTS[i][0], y: PIVOTS[i][1], a: 0,
    vx: (PIVOTS[i][0] < 58 ? -1 : 1) * (4 + Math.random() * 6), vy: -8,
    va: (Math.random() - 0.5) * 2, t: 0, landed: false, rest: 0,
    L: L.b.y1 - PIVOTS[i][1], hw: (L.b.x1 - L.b.x0) / 2, dir: Math.random() < 0.5 ? -1 : 1,
  });
  for (let k = 0; k < 6; k++) particles.push({
    x: PIVOTS[i][0] + (Math.random() - 0.5) * 4, y: PIVOTS[i][1] + 4, vx: (Math.random() - 0.5) * 30, vy: -Math.random() * 25,
    life: 0.6 + Math.random() * 0.4, c: Math.random() < 0.5 ? '#8a5a35' : '#b98a4b', g: 90,
  });
  shakeT = 0.3;
  sfx.snip();
  if (allTrimmed()) {
    treesTrimmed++; // one more palm gets color in the Collection
    bridge.track('tree_complete', { treesTrimmed });
    setTimeout(celebrate, 900);
  }
  save();
}

function dropCoconut() {
  // the next coconut in order that is hanging on the tree
  let i = -1;
  for (let k = 0; k < COCO_COUNT; k++) { const j = (cocoNext + k) % COCO_COUNT; if (coconuts[j].state === 'on') { i = j; break; } }
  shakeT = 0.25;
  // leaf bits shaken loose, every click (so a click always does something)
  for (let k = 0; k < 4; k++) particles.push({
    x: 50 + Math.random() * 20, y: 100 + Math.random() * 10, vx: (Math.random() - 0.5) * 30, vy: -Math.random() * 15,
    life: 0.5 + Math.random() * 0.4, c: Math.random() < 0.5 ? '#2f9e3a' : '#6fc24a', g: 60,
  });
  sfx.rustle();
  logCoconut(i >= 0);
  if (i < 0) return; // clicked faster than they regrow: just a rustle this time
  cocoNext = (i + 1) % COCO_COUNT;
  const c = coconuts[i]; c.state = 'gone'; c.t = 0;
  const C = A.coco[i], b = C.b;
  cocoFalling.push({
    img: C.crop, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1,
    x: (b.x0 + b.x1 + 1) / 2, y: (b.y0 + b.y1 + 1) / 2, r: Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2,
    vx: (Math.random() - 0.5) * 40, vy: -15, a: 0, ground: false, rest: 0, bounces: 0,
  });
  // too many on the ground -> oldest start fading
  const resting = cocoFalling.filter((f) => f.ground);
  if (resting.length > COCO_MAX_GROUND) resting[0].rest = Math.max(resting[0].rest, COCO_REST);
}
function logCoconut(dropped) {
  if (!cocoPlay.clicks) cocoPlay.start = Date.now();
  cocoPlay.clicks++; if (dropped) cocoPlay.drops++;
  clearTimeout(cocoPlay.timer);
  cocoPlay.timer = setTimeout(() => { // 3s after the last click: one row for the whole burst
    bridge.track('coconut_play', { clicks: cocoPlay.clicks, drops: cocoPlay.drops, seconds: Math.round((Date.now() - cocoPlay.start) / 100) / 10 });
    cocoPlay.clicks = 0; cocoPlay.drops = 0;
  }, 3000);
}

function celebrate() {
  sfx.yay();
  for (let k = 0; k < 18; k++) {
    const ang = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 30;
    particles.push({ x: 58, y: 100, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 10, life: 1 + Math.random(), c: ['#fff6a8', '#ffffff', '#ffd35c'][k % 3], g: 10, star: true });
  }
}

function regrowAll() {
  bridge.track('regrow_all', { cutLeaves: leaves.filter((l) => l.state === 'gone').length });
  leaves.forEach((l) => { if (l.state === 'gone') { l.state = 'growing'; l.grow = 0; l.manual = true; } });
  save();
}

// ---------- update ----------
function update(dt) {
  const now = Date.now();
  // regrowth
  leaves.forEach((l) => {
    if (l.state === 'gone' && now - l.cutAt > REGROW_MS[regrowSpeed]) { l.state = 'growing'; l.grow = 0; }
    if (l.state === 'growing') {
      l.grow += dt / 2.5;
      if (l.grow >= 1) {
        l.state = 'on'; l.availableAt = now;
        bridge.track('leaf_regrown', { leaf: leaves.indexOf(l) + 1, afterMin: Math.round(((now - l.cutAt) / 60000) * 10) / 10, manual: !!l.manual, speed: regrowSpeed });
        l.manual = false;
        save();
      }
    }
  });

  // worker state machine (see METHODS above)
  const w = worker;
  w.t += dt;
  switch (w.state) {
    case 'away':
      if (nextTarget() >= 0) {
        w.method = pickMethod(); w.last = w.method; w.dy = 0; w.climbed = 0;
        bridge.track('worker_visit', { method: w.method, queued: queue.length });
        if (w.method === 'bucket') { w.p = 0; setW('bucketIn'); }
        else { w.x = START_X; setW('walkIn'); }
      }
      break;
    case 'walkIn': {
      w.x += WALK_SPEED * dt;
      const stop = w.method === 'side' ? SIDE_X : STOP_X;
      if (w.x >= stop) { w.x = stop; setW(w.method === 'side' ? 'climb' : 'arrive'); }
      break;
    }
    case 'arrive':
      if (w.t > ARRIVE_IDLE) setW('turnIn');
      break;
    case 'turnIn':
      if (w.t > TURN_STEP * 3) setW(nextTarget() >= 0 ? 'climb' : 'turnOut');
      break;
    case 'climb': {
      const j = nextTarget();
      if (j < 0) { setW('climbDown'); break; }
      w.target = j;
      const ty = targetDy(j), d = ty - w.dy, sp = d < 0 ? CLIMB_UP_SPEED : CLIMB_DOWN_SPEED;
      if (Math.abs(d) <= sp * dt) { w.dy = ty; setW('cut'); }
      else { w.dy += Math.sign(d) * sp * dt; w.climbed += sp * dt; }
      w.x = climbX(w.dy);
      break;
    }
    case 'bucketIn':
      if (w.state === 'bucketIn') {
        w.p = Math.min(1, w.p + dt / BUCKET_TIME);
        if (w.p >= 1) {
          const j = nextTarget();
          if (j >= 0) { w.target = j; setW('cut'); } else setW('bucketOut');
        }
      }
      break;
    case 'cut':
      if (w.t > CUT_TIME) { cutLeaf(w.target); setW('afterCut'); }
      break;
    case 'afterCut':
      if (w.t > 0.4) {
        const j = nextTarget();
        if (w.method === 'bucket') { if (j >= 0) { w.target = j; setW('cut'); } else setW('bucketOut'); }
        else setW(j >= 0 ? 'climb' : 'climbDown');
      }
      break;
    case 'bucketOut':
      if (nextTarget() >= 0) { setW('bucketIn'); break; }
      w.p = Math.max(0, w.p - dt / BUCKET_TIME);
      if (w.p <= 0) setW('away');
      break;
    case 'climbDown':
      if (nextTarget() >= 0) { setW('climb'); break; }
      w.dy += CLIMB_DOWN_SPEED * dt; w.climbed += CLIMB_DOWN_SPEED * dt;
      w.x = climbX(w.dy);
      if (w.dy >= 0) { w.dy = 0; setW(w.method === 'side' ? 'walkOut' : 'turnOut'); }
      break;
    case 'turnOut':
      if (w.t > TURN_STEP * 3) setW('leaveIdle');
      break;
    case 'leaveIdle':
      if (nextTarget() >= 0) { setW('turnIn'); break; }
      if (w.t > LEAVE_IDLE) setW('walkOut');
      break;
    case 'walkOut':
      if (nextTarget() >= 0) { setW('walkIn'); break; }
      w.x -= WALK_SPEED * dt;
      if (w.x <= START_X) setW('away');
      break;
  }

  // falling leaves
  for (let k = falling.length - 1; k >= 0; k--) {
    const f = falling[k]; f.t += dt;
    if (!f.landed) {
      f.vy = Math.min(f.vy + 70 * dt, 45);
      f.x += (f.vx + Math.sin(f.t * 5) * 10) * dt;
      f.y += f.vy * dt;
      f.a += (f.va + Math.cos(f.t * 5) * 1.2) * dt;
      f.x = Math.max(-OX + 4, Math.min(VIEW_W - OX - 4, f.x));
      const down = Math.abs(Math.cos(f.a)) * f.L + Math.abs(Math.sin(f.a)) * f.hw;
      if (f.y + down >= GROUND) { f.landed = true; sfx.thud(); }
    } else {
      const target = f.dir * Math.PI / 2;
      f.a += (target - f.a) * Math.min(1, dt * 8);
      const down = Math.abs(Math.cos(f.a)) * f.L + Math.abs(Math.sin(f.a)) * f.hw;
      f.y = GROUND - down;
      f.rest += dt;
      if (f.rest > 6) falling.splice(k, 1);
    }
  }

  // coconuts regrow on the tree
  for (const c of coconuts) {
    c.t += dt;
    if (c.state === 'gone' && c.t > COCO_REGROW_DELAY) { c.state = 'growing'; c.grow = 0; }
    if (c.state === 'growing') { c.grow += dt / COCO_GROW_TIME; if (c.grow >= 1) { c.grow = 1; c.state = 'on'; } }
  }
  // falling coconuts: drop, bounce, roll, rest, fade
  for (let k = cocoFalling.length - 1; k >= 0; k--) {
    const f = cocoFalling[k];
    const minX = -OX + f.r, maxX = VIEW_W - OX - f.r;
    if (!f.ground) {
      f.vy += COCO_GRAVITY * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.a += (f.vx / f.r) * dt;
      if (f.y + f.r >= GROUND) {
        f.y = GROUND - f.r;
        if (f.vy > 40 && f.bounces < 3) {
          sfx.bonk(Math.min(1, f.vy / 180));
          f.vy = -f.vy * 0.4; f.vx = f.vx * 0.8 + (Math.random() - 0.5) * 20; f.bounces++;
        } else { if (!f.bounces) sfx.bonk(0.6); f.vy = 0; f.ground = true; }
      }
    } else {
      f.vx *= Math.max(0, 1 - dt * 2.2);      // rolling friction
      f.x += f.vx * dt; f.a += (f.vx / f.r) * dt;
      if (Math.abs(f.vx) < 2) f.rest += dt;
      if (f.rest > COCO_REST + 1) cocoFalling.splice(k, 1);
    }
    if (f.x < minX) { f.x = minX; f.vx = Math.abs(f.vx) * 0.5; }
    if (f.x > maxX) { f.x = maxX; f.vx = -Math.abs(f.vx) * 0.5; }
  }

  // particles
  for (let k = particles.length - 1; k >= 0; k--) {
    const p = particles[k]; p.life -= dt;
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0 || p.y > GROUND) particles.splice(k, 1);
  }
  if (shakeT > 0) shakeT -= dt;
}

// ---------- draw ----------
function draw() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.imageSmoothingEnabled = false;
  const sx = shakeT > 0 ? Math.round(Math.sin(shakeT * 70)) : 0;
  const tx = OX + sx, ty = OY;

  ctx.drawImage(A.tree.img, tx, ty);
  for (let i = 0; i < COCO_COUNT; i++) {
    const c = coconuts[i]; if (c.state === 'gone') continue;
    const C = A.coco[i], b = C.b;
    if (c.state === 'on') { ctx.drawImage(C.img, tx, ty); continue; }
    // growing back: pops in from its stem (top middle), with a tiny overshoot
    const g = c.grow, s = Math.max(0.05, 1 + 1.7 * Math.pow(g - 1, 3) + 0.7 * Math.pow(g - 1, 2));
    const cx = (b.x0 + b.x1 + 1) / 2;
    ctx.globalAlpha = Math.min(1, g * 2);
    ctx.drawImage(C.crop, Math.round(tx + cx - (C.crop.width * s) / 2), Math.round(ty + b.y0), Math.round(C.crop.width * s), Math.round(C.crop.height * s));
    ctx.globalAlpha = 1;
  }
  if (worker.method !== 'bucket') drawWorker();
  for (let i = 0; i < LEAF_COUNT; i++) {
    const l = leaves[i]; if (l.state === 'gone') continue;
    ctx.globalAlpha = l.state === 'growing' ? l.grow : 1;
    ctx.drawImage(A.leaf[i].img, tx, ty);
    const glow = (hover && hover.type === 'leaf' && hover.i === i && l.state === 'on') ? 0.35
      : (l.state === 'targeted' ? 0.2 + 0.2 * Math.sin(performance.now() / 120) : 0);
    if (glow > 0) { ctx.globalAlpha = glow; ctx.drawImage(A.leaf[i].white, tx + A.leaf[i].b.x0, ty + A.leaf[i].b.y0); }
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(A.front.img, tx, ty);
  if (worker.method === 'bucket') drawWorker(); // the bucket sits in front of the leaves

  // falling leaves
  for (const f of falling) {
    ctx.save();
    ctx.globalAlpha = f.rest > 5 ? Math.max(0, 6 - f.rest) : 1;
    ctx.translate(Math.round(f.x + OX), Math.round(f.y + OY));
    ctx.rotate(f.a);
    ctx.drawImage(f.img, -f.px, -f.py);
    ctx.restore();
  }
  // fallen coconuts
  for (const f of cocoFalling) {
    ctx.save();
    ctx.globalAlpha = f.rest > COCO_REST ? Math.max(0, COCO_REST + 1 - f.rest) : 1;
    ctx.translate(Math.round(f.x + OX), Math.round(f.y + OY));
    ctx.rotate(f.a);
    ctx.drawImage(f.img, -Math.round(f.w / 2), -Math.round(f.h / 2));
    ctx.restore();
  }
  // particles
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.c;
    const x = Math.round(p.x + OX), y = Math.round(p.y + OY);
    ctx.fillRect(x, y, 1, 1);
    if (p.star && p.life > 0.4) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
  }
  ctx.globalAlpha = 1;
}

function drawWorker() {
  const w = worker;
  if (w.state === 'away') return;
  if (w.method === 'bucket') {
    // slide the whole truck image along the boom: p=0 hidden bottom-left, p=1 your drawn position
    const k = 1 - ease(w.p);
    const shake = w.state === 'cut' ? Math.round(Math.sin(w.t * 40)) : 0;
    const bx = -BUCKET_TRAVEL * k, by = BUCKET_TRAVEL * (BOOM_STEP[1] / BOOM_STEP[0]) * k;
    ctx.drawImage(BUCKET.canvas, Math.round(OX - BUCKET.ext + bx + shake), Math.round(OY + by));
    return;
  }
  const walkF = 'walk' + (1 + (Math.floor(w.t * WALK_FPS) % 4));
  switch (w.state) {
    case 'walkIn': drawSprite(walkF, w.x, 0, false); break;
    case 'walkOut': drawSprite(walkF, w.x, 0, true); break;
    case 'arrive': case 'leaveIdle': drawSprite('idle', w.x, 0, false); break;
    case 'turnIn': drawSprite('turn' + Math.min(3, 1 + Math.floor(w.t / TURN_STEP)), w.x, 0, false); break;
    case 'turnOut': drawSprite('turn' + Math.max(1, 3 - Math.floor(w.t / TURN_STEP)), w.x, 0, false); break;
    default: { // on the trunk: climb / cut
      const shake = w.state === 'cut' ? Math.round(Math.sin(w.t * 40)) : 0;
      const moving = w.state === 'climb' || w.state === 'climbDown';
      if (w.method === 'side') {
        const f = moving && Math.floor(w.climbed / 6) % 2 === 1 ? 'climb-side-view2' : 'climb-side-view1';
        drawSprite(f, w.x + shake, w.dy, false);
      } else {
        const flip = moving && Math.floor(w.climbed / 8) % 2 === 1; // mirror every 8px = simple climbing motion
        drawSprite('climb', w.x + shake, w.dy, flip);
      }
    }
  }
}

// Build the bucket-truck image with the boom continued off the left edge of your canvas,
// by repeating the first 17 columns of your boom down-left.
function buildBucket() {
  const src = SPR['bucket-truck'];
  const img = A.bucketImg;
  const ext = 260, [sx, sy] = BOOM_STEP;
  const reps = Math.ceil(ext / sx);
  const c = document.createElement('canvas');
  c.width = 128 + ext; c.height = 400 + reps * sy;
  const g = c.getContext('2d');
  for (let r = reps; r >= 1; r--) g.drawImage(img, 0, 0, sx, 400, ext - r * sx, r * sy, sx, 400);
  g.drawImage(img, ext, 0);
  BUCKET = { canvas: c, ext, src };
}

// ---------- onboarding: 4 text cards next to the tree, one at a time ----------
// Position/size in art pixels (your Figma frame is the art at 2x: 224px wide, 14px text).
const ONB = { x: 126, y: 74, w: 112, h: 80, font: 7, spacing: -0.175, travel: 14 };
const onb = { active: false, done: false, i: 0, lockUntil: 0, acc: 0, accT: 0 };
const cards = Array.from(document.querySelectorAll('#onb .card'));
onbReady = true;
layoutOnboarding();

function layoutOnboarding() {
  const box = document.getElementById('onb');
  if (!box) return;
  box.style.left = (ONB.x + OX) * scale + 'px';
  box.style.top = (ONB.y + OY) * scale + 'px';
  box.style.width = ONB.w * scale + 'px';
  for (const c of cards) {
    c.style.fontSize = ONB.font * scale + 'px';
    c.style.letterSpacing = ONB.spacing * scale + 'px';
  }
  placeCards(true);
}
// put every card in its slot: earlier cards above (gone), current shown, later ones below (waiting)
function placeCards(instant) {
  const d = ONB.travel * scale;
  cards.forEach((c, k) => {
    c.classList.toggle('instant', !!instant);
    const pos = !onb.active ? (onb.i >= cards.length ? -1 : 1) : Math.sign(k - onb.i);
    c.style.transform = `translateY(${pos * d}px)`;
    c.classList.toggle('shown', onb.active && k === onb.i);
  });
  if (instant) requestAnimationFrame(() => cards.forEach((c) => c.classList.remove('instant')));
}
function startOnboarding(restart = false) {
  onb.active = true; onb.i = 0; onb.lockUntil = performance.now() + 400; onb.startedAt = Date.now();
  bridge.track('onboarding_start', { restart });
  placeCards(true);
}
function nextCard() {
  if (!onb.active) return;
  onb.lockUntil = performance.now() + 700;  // one scroll gesture = one step
  if (onb.i < cards.length - 1) { onb.i++; placeCards(false); bridge.track('onboarding_card', { card: onb.i + 1 }); }
  else finishOnboarding('scroll');
}
function finishOnboarding(via) {
  bridge.track('onboarding_done', { via, seconds: Math.round((Date.now() - (onb.startedAt || Date.now())) / 1000) });
  onb.i = cards.length; onb.active = false; onb.done = true;
  placeCards(false);
  save();
}
window.addEventListener('wheel', (e) => {
  if (!onb.active) return;
  const now = performance.now();
  // A gesture ends after 300ms with no scroll events (this also swallows macOS momentum scrolling).
  if (now - onb.accT > 300) { onb.acc = 0; onb.used = false; }
  onb.accT = now;
  if (onb.used || now < onb.lockUntil) return;   // one gesture = one card, never more
  onb.acc += Math.abs(e.deltaY) + Math.abs(e.deltaX);
  if (onb.acc > 30) { onb.used = true; nextCard(); }
}, { passive: true });

// ---------- input ----------
function toSource(e) { return [e.offsetX / scale - OX, e.offsetY / scale - OY]; }
function setClickThrough(on) { if (on !== clickThrough) { clickThrough = on; bridge.setClickThrough(on); } }

canvas.addEventListener('mousemove', (e) => {
  if (dragging) { bridge.dragMove(); return; }
  const [sx, sy] = toSource(e);
  hover = hitTest(sx, sy);
  setClickThrough(!hover);
  canvas.style.cursor = !hover ? 'default'
    : hover.type === 'leaf' ? (leaves[hover.i].state === 'on' ? 'pointer' : 'default')
    : hover.type === 'tree' ? 'grab' : hover.type === 'text' ? 'default' : 'pointer';
});
canvas.addEventListener('mouseleave', () => { if (!dragging) { hover = null; setClickThrough(true); } });
canvas.addEventListener('mousedown', (e) => {
  audio();
  const [sx, sy] = toSource(e);
  const h = hitTest(sx, sy);
  if (!h) return;
  if (h.type === 'leaf') requestCut(h.i);
  else if (h.type === 'coconut') dropCoconut();
  else if (h.type === 'tree') { dragging = true; canvas.style.cursor = 'grabbing'; bridge.dragStart(); }
});
window.addEventListener('mouseup', () => { if (dragging) { dragging = false; canvas.style.cursor = 'grab'; bridge.dragEnd(); } });

bridge.onCommand((cmd, arg) => {
  if (cmd === 'scale') applyScale(arg);
  if (cmd === 'regrow-all') regrowAll();
  if (cmd === 'restart-onboarding') startOnboarding(true);
  if (cmd === 'method') forcedMethod = arg === 'random' ? null : arg;
  if (cmd === 'regrow-speed') { regrowSpeed = arg; save(); }
  if (cmd === 'sound') { soundOn = arg; save(); }
  if (cmd === 'collection-add') { treesTrimmed++; save(); }       // Testing menu
  if (cmd === 'collection-reset') { treesTrimmed = 0; save(); }   // Testing menu
});

// ---------- boot ----------
async function boot() {
  const load = async (n) => { const img = await loadImg(await bridge.asset(n)); return { img, a: alphaOf(img) }; };
  A.tree = await load('palm-tree');
  A.front = await load('front-leaves');
  A.leaf = [];
  for (let i = 1; i <= LEAF_COUNT; i++) {
    const L = await load(`old-leaf-${i}`);
    L.b = bboxOf(L.a, 128, 400);
    L.crop = cropCanvas(L.img, L.b);
    // white silhouette used for the hover glow
    const w = cropCanvas(L.img, L.b); const g = w.getContext('2d');
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, w.width, w.height);
    L.white = w;
    A.leaf.push(L);
  }
  A.coco = [];
  for (let i = 0; i < COCO_COUNT; i++) {
    const C = await load(`coconut${i}`);
    C.b = bboxOf(C.a, 128, 400);
    C.crop = cropCanvas(C.img, C.b);
    A.coco.push(C);
    coconuts.push({ state: 'on', t: 0, grow: 1 });
  }
  // trunk center for each row, walking up from the base
  let c = null;
  for (let y = 399; y >= 0; y--) {
    const xs = [];
    for (let x = 0; x < 128; x++) if (A.tree.a[y * 128 + x] && (c === null || Math.abs(x - c) <= 8)) xs.push(x);
    if (xs.length && (c === null || y > 120)) c = xs.reduce((s, v) => s + v, 0) / xs.length;
    trunkC[y] = c;
  }
  const baseC = trunkC.find((v) => v != null) ?? 58;
  for (let y = 0; y < 400; y++) if (trunkC[y] == null) trunkC[y] = baseC;

  // worker frames
  for (const n of W_FRAMES) {
    const S = await load(`worker-${n}`);
    const b = bboxOf(S.a, 128, 400);
    const hcX = []; // helmet center = middle of the top 6 rows
    for (let y = b.y0; y < b.y0 + 6; y++) for (let x = 0; x < 128; x++) if (S.a[y * 128 + x]) hcX.push(x);
    if (n === 'bucket-truck') A.bucketImg = S.img;
    SPR[n] = { crop: cropCanvas(S.img, b), x0: b.x0, y0: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, hc: hcX.reduce((a, v) => a + v, 0) / hcX.length };
  }
  STOP_X = SPR.idle.hc; CLIMB_X = SPR.climb.hc; SIDE_X = SPR['climb-side-view1'].hc;
  START_X = -OX - SPR.walk1.w;  // fully outside the window's left edge
  buildBucket();
  worker.x = START_X;

  const saved = await bridge.loadState();
  for (let i = 0; i < LEAF_COUNT; i++) {
    const s = saved && saved.leaves && saved.leaves[i];
    leaves.push(s && s.state === 'gone' ? { state: 'gone', cutAt: s.cutAt } : { state: 'on', cutAt: 0, availableAt: (s && s.availableAt) || Date.now() });
  }
  if (saved) { regrowSpeed = saved.regrowSpeed || 'normal'; soundOn = saved.sound !== false; treesTrimmed = saved.treesTrimmed || 0; }
  try { const ff = new FontFace('Pixelify Sans', `url(${await bridge.font()})`, { weight: '600' }); await ff.load(); document.fonts.add(ff); } catch (e) { console.log('font', e); }
  onb.done = !!(saved && saved.onboarded);
  if (!onb.done) startOnboarding();

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    update(dt); draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__game = { setMethod: (m) => { forcedMethod = m; }, onb, nextCard, startOnboarding, leaves, worker, falling, requestCut, regrowAll, hitTest, dropCoconut, coconuts, cocoFalling, trunkX, A };
}
boot();
