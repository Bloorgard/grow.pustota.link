/* grow.pustota.link — обрастание вокруг пользовательских стен и SVG.
   Механика роста из буквы Ю (alphabet.pustota.link), режим «обрастание».
   Стены хранятся как векторные штрихи: сетка нужна только для столкновений. */

import {
  GRID_BASE, AR, GX, GY, shape, proportion,
  setField, aspect, at, inBounds, clipField,
  dxOf, dyOf, angleTo, distOf,
} from './field.js';
import { buildRail, buildSettings, buildBar, buildQuick } from './ui.js';

const INK = '#f1ede5';
const PAPER = '#161616';
const RED = '#e0210f';
const MUTED = 'rgba(241,237,229,.45)';
const STEP = 1 / 60;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const FOOD_LIFE = 17;
const TRAIL_STEP = 0.06;
const MAX_TIPS = 520;
const MAX_SEGMENTS = 160000;
const EXPORT_LONG_SIDE = 2048;
const STORE_KEY = 'grow.pustota.v1';

const canvas = document.getElementById('canvas');
const sheet = document.getElementById('sheet');
const ctx = canvas.getContext('2d');
let Sx = 600, Sy = 600, dpr = 1;
let last = performance.now(), debt = 0;
let paused = false;
let mode = 'walls';
let hasInteracted = false;

/* ===== параметры ===== */

const DEFAULTS = {
  auto: true, showWalls: false,
  speed: 8, mass: 5, branch: 5, seeds: 7, crowd: 12,
  sow: 0, gap: 0.007, step: 0.009,
  wander: 1, straight: 0.14, pull: 0.55, life: 3,
  shape: 'rect', proportion: 0, brush: 6,
};
const GROWTH_KEYS = ['mass', 'branch', 'seeds', 'crowd', 'sow', 'gap', 'step', 'wander', 'straight', 'pull', 'life'];
const PRESETS = {
  'мох':   { speed: 8, mass: 5, branch: 5, seeds: 7, crowd: 12, sow: 1, gap: 0.007, step: 0.009, wander: 1, straight: 0.14, pull: 0.55, life: 3 },
  'иней':  { speed: 12, mass: 2, branch: 8, seeds: 10, crowd: 24, sow: 0, gap: 0.004, step: 0.006, wander: 1.6, straight: 0.3, pull: 0.4, life: 1.5 },
  'плети': { speed: 10, mass: 3, branch: 1, seeds: 4, crowd: 8, sow: 1, gap: 0.013, step: 0.021, wander: 0.4, straight: 0.6, pull: 0.9, life: 6 },
  'корни': { speed: 6, mass: 7, branch: 2, seeds: 3, crowd: 6, sow: 0, gap: 0.02, step: 0.024, wander: 0.8, straight: 0.45, pull: 1.2, life: 5 },
};

const values = { ...DEFAULTS };
const num = key => Number(values[key]);
const on = key => !!values[key];

/* ===== сетка столкновений =====
   Пропорции сетки следуют формату холста, поэтому её ячейки квадратные
   на экране, и рост не растягивается на неквадратных листах. */

let walls = new Uint8Array(GX * GY);
let wallCells = [];
let wallsPresent = false;
let gridDirty = true;
const gridCanvas = document.createElement('canvas');

function applyField(nextShape, nextProportion) {
  setField(nextShape, nextProportion);
  walls = new Uint8Array(GX * GY);
  gridDirty = true;
  if (growth) {
    growth.grown = new Uint8Array(GX * GY);
    rebuildGrowthMask();
  }
}

/* ===== стены: штрихи ===== */

let wallOps = [];
let undoStack = [];
let current = null;
let brushErase = false;
const wallCanvas = document.createElement('canvas');

const brushRadius = () => num('brush') / GRID_BASE;

function drawOp(g, PW, PH, op, plain) {
  if (op.k === 'svg') {
    if (!op.img) return;
    const x = op.x * PW, y = op.y * PH, w = op.w * PW, h = op.h * PH;
    g.globalCompositeOperation = 'source-over';
    if (plain) { g.drawImage(op.img, x, y, w, h); return; }
    const scratch = document.createElement('canvas');
    scratch.width = Math.max(1, Math.round(w));
    scratch.height = Math.max(1, Math.round(h));
    const sg = scratch.getContext('2d');
    sg.filter = 'brightness(0)';
    sg.drawImage(op.img, 0, 0, scratch.width, scratch.height);
    sg.filter = 'none';
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = INK;
    sg.fillRect(0, 0, scratch.width, scratch.height);
    g.drawImage(scratch, x, y, w, h);
    return;
  }
  const pts = op.pts;
  if (!pts.length) return;
  g.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(0.8, op.r * 2 * PH);
  g.beginPath();
  g.moveTo(pts[0][0] * PW, pts[0][1] * PH);
  if (pts.length === 1) g.lineTo(pts[0][0] * PW + 0.01, pts[0][1] * PH);
  else for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i][0] * PW, pts[i][1] * PH);
  g.stroke();
  g.globalCompositeOperation = 'source-over';
}

function paintOps(g, PW, PH, plain) {
  for (const op of wallOps) drawOp(g, PW, PH, op, plain);
}

function rebuildWallCanvas() {
  wallCanvas.width = Math.max(1, Math.round(Sx * dpr));
  wallCanvas.height = Math.max(1, Math.round(Sy * dpr));
  const g = wallCanvas.getContext('2d');
  g.clearRect(0, 0, wallCanvas.width, wallCanvas.height);
  paintOps(g, wallCanvas.width, wallCanvas.height, false);
  if (current) drawOp(g, wallCanvas.width, wallCanvas.height, current, false);
}

/* Досовываем только последний отрезок — перерисовывать всё каждый кадр незачем. */
function strokeLive(p0, p1) {
  const g = wallCanvas.getContext('2d');
  drawOp(g, wallCanvas.width, wallCanvas.height, { k: 'b', erase: brushErase, r: brushRadius(), pts: [p0, p1] }, false);
}

/* Растеризация штрихов в сетку столкновений. */
function ensureGrid() {
  if (!gridDirty) return;
  gridCanvas.width = GX;
  gridCanvas.height = GY;
  const g = gridCanvas.getContext('2d');
  g.clearRect(0, 0, GX, GY);
  paintOps(g, GX, GY, true);
  const data = g.getImageData(0, 0, GX, GY).data;
  walls.fill(0);
  wallCells = [];
  wallsPresent = false;
  for (let i = 0; i < GX * GY; i += 1) {
    if (data[i * 4 + 3] <= 32) continue;
    walls[i] = 1;
    wallsPresent = true;
    const ix = i % GX, iy = (i / GX) | 0;
    if (ix % 3 === 0 && iy % 3 === 0) wallCells.push(i);
  }
  if (wallsPresent && !wallCells.length) {
    for (let i = 0; i < walls.length; i += 1) if (walls[i]) wallCells.push(i);
  }
  gridDirty = false;
}

function pushUndo() {
  undoStack.push(wallOps.slice());
  if (undoStack.length > 80) undoStack.shift();
  updateControls();
}

function undoWalls() {
  if (!undoStack.length) return;
  wallOps = undoStack.pop();
  updateControls();
  gridDirty = true;
  rebuildWallCanvas();
  updateGrowButton();
  saveSoon();
}

function clearWalls() {
  pushUndo();
  wallOps = [];
  gridDirty = true;
  rebuildWallCanvas();
  updateGrowButton();
  saveSoon();
}

/* ===== сообщение ===== */

function showMessage(text = '') {
  const message = document.getElementById('message');
  message.textContent = text;
  message.hidden = !text;
}

/* ===== загрузка SVG ===== */

let svgOverlay = null;
let importVersion = 0;
const overlayWidth = o => o.h * o.ia / AR;

function loadSVG(file) {
  const version = ++importVersion;
  showMessage();
  const fail = () => {
    if (version === importVersion) showMessage('Не удалось открыть SVG. Проверьте файл и попробуйте снова.');
  };
  const reader = new FileReader();
  reader.onerror = fail;
  reader.onload = () => {
    if (version !== importVersion) return;
    const svgText = reader.result;
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
      fail();
      return;
    }
    const src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
    const img = new Image();
    img.onerror = fail;
    img.onload = () => {
      if (version !== importVersion) return;
      setMode('walls');
      const ia = (img.naturalWidth || 300) / (img.naturalHeight || 300);
      let h = 0.6, w = h * ia / AR;
      if (w > 0.6) { w = 0.6; h = w * AR / ia; }
      svgOverlay = {
        img, src, ia, h, baseH: h,
        x: (1 - w) / 2, y: (1 - h) / 2,
        dragging: false, grabDx: 0, grabDy: 0,
      };
      hasInteracted = true;
      syncSVGScale();
      updateControls();
      updateHint();
      updateGrowButton();
    };
    img.src = src;
  };
  reader.readAsText(file);
}

function applySVG() {
  if (!svgOverlay) return;
  showMessage();
  const o = svgOverlay;
  pushUndo();
  wallOps.push({ k: 'svg', src: o.src, img: o.img, x: o.x, y: o.y, w: overlayWidth(o), h: o.h });
  svgOverlay = null;
  gridDirty = true;
  rebuildWallCanvas();
  updateControls();
  updateHint();
  updateGrowButton();
  saveSoon();
}

function cancelSVG() {
  showMessage();
  svgOverlay = null;
  updateControls();
  updateHint();
  updateGrowButton();
}

function scaleSVG(nextH, cx, cy) {
  const o = svgOverlay;
  const oldW = overlayWidth(o), oldH = o.h;
  o.h = clamp(nextH, o.baseH * 0.1, o.baseH * 5);
  const w = overlayWidth(o);
  o.x = cx - (cx - o.x) * (w / oldW);
  o.y = cy - (cy - o.y) * (o.h / oldH);
  syncSVGScale();
}

function syncSVGScale() {
  if (!svgOverlay) return;
  updateControls();
}

/* ===== рост ===== */

let growth = null;
let previousGrowth = null;
const pointer = { x: -1, y: -1, id: null, down: false };
let wallDrawing = false;

function claim(x, y) {
  const r = Math.max(1, Math.round(num('gap') * GY));
  const ci = Math.round(x * GX), cj = Math.round(y * GY);
  for (let j = cj - r; j <= cj + r; j += 1) {
    for (let i = ci - r; i <= ci + r; i += 1) {
      if (i < 0 || j < 0 || i >= GX || j >= GY) continue;
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      growth.grown[j * GX + i] = 1;
    }
  }
}

function nearWall(x, y, wallsOnly) {
  const ix = Math.floor(x * GX), iy = Math.floor(y * GY);
  const reach = Math.max(2, Math.round(GY * (num('gap') + 0.008)));
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const px = ix + dx, py = iy + dy;
      if (px < 0 || py < 0 || px >= GX || py >= GY) continue;
      const key = py * GX + px;
      if (walls[key] || (!wallsOnly && growth.grown[key])) return true;
    }
  }
  return false;
}

function sprout(x, y, anyWall = false) {
  if (!anyWall) {
    let closest = null;
    for (const idx of wallCells) {
      const px = (idx % GX + 0.5) / GX, py = ((idx / GX | 0) + 0.5) / GY;
      const distance = distOf(x, y, px, py);
      if (!closest || distance < closest.distance) closest = { x: px, y: py, distance };
    }
    if (!closest) return false;
    x = closest.x; y = closest.y;
  }
  for (let n = 0; n < 900; n += 1) {
    const wide = n > 300;
    const a = Math.random() * TAU;
    const r = 0.01 + Math.random() * (wide ? 0.5 : 0.045);
    const px = x + dxOf(a, r), py = y + dyOf(a, r);
    const key = at(px, py);
    if (key < 0 || !inBounds(px, py) || walls[key] || growth.grown[key]) continue;
    const where = num('sow');
    if (where === 0 && !nearWall(px, py, true)) continue;
    if (where === 1 && !nearWall(px, py, false)) continue;
    claim(px, py);
    growth.tips.push(makeTip(px, py, anyWall ? a : angleTo(px, py, x, y)));
    return true;
  }
  return false;
}

function makeTip(x, y, a, life) {
  const mass = num('mass');
  return {
    id: growth.tipSeq += 1,
    x, y, a, age: 0,
    life: life || (70 + Math.random() * 190) * num('life'),
    width: 0.0014 + mass * 0.00055 + Math.random() * mass * 0.00025,
  };
}

function feed(x, y) {
  if (!inBounds(x, y)) return false;
  let any = false;
  if (nearWall(x, y, false)) {
    for (let i = 0; i < num('seeds'); i += 1) if (sprout(x, y, true)) any = true;
  }
  growth.food.push({ x, y, age: 0 });
  if (growth.food.length > 9) growth.food.shift();
  for (let i = 0; i < num('seeds'); i += 1) if (sprout(x, y)) any = true;
  return any;
}

function grow(tip, index) {
  let best = null;
  for (let trial = 0; trial < 14; trial += 1) {
    const spread = trial < 7 ? 1.75 : TAU;
    const a = tip.a + (Math.random() - 0.5) * spread * num('wander');
    const step = Math.max(num('step'), num('gap') * 1.35);
    const x = tip.x + dxOf(a, step), y = tip.y + dyOf(a, step);
    const key = at(x, y);
    if (key < 0 || !inBounds(x, y) || walls[key] || growth.grown[key]) continue;
    let pull = Math.cos(a - tip.a) * num('straight');
    for (const food of growth.food) {
      const target = angleTo(tip.x, tip.y, food.x, food.y);
      const distance = distOf(tip.x, tip.y, food.x, food.y);
      pull += Math.cos(a - target) * num('pull') / (0.08 + distance * 2.2);
    }
    if (!best || pull > best.pull) best = { x, y, a, pull };
  }
  if (!best || tip.age > tip.life) { growth.tips.splice(index, 1); return; }
  claim(best.x, best.y);
  const segment = {
    x1: tip.x, y1: tip.y, x2: best.x, y2: best.y,
    t: tip.id, width: tip.width,
  };
  growth.segments.push(segment);
  strokeSegment(segment);
  tip.x = best.x; tip.y = best.y; tip.a = best.a; tip.age += 1;
  if (Math.random() < num('branch') * 0.012 && growth.tips.length < MAX_TIPS) {
    const child = makeTip(tip.x, tip.y, tip.a + (Math.random() - 0.5) * 1.4, tip.life * (0.55 + Math.random() * 0.35));
    child.age = tip.age;
    growth.tips.push(child);
  }
}

function startGrowth() {
  growth = {
    grown: new Uint8Array(GX * GY),
    tips: [], segments: [], food: [],
    time: 0, autoAt: 0.35, trail: null, leading: false, tipSeq: 0,
    surface: null, surfaceW: 0, surfaceH: 0,
    done: false, idle: 0, misses: 0,
  };
}

function rebuildGrowthMask() {
  if (!growth) return;
  growth.grown.fill(0);
  for (const seg of growth.segments) {
    claim(seg.x1, seg.y1);
    claim(seg.x2, seg.y2);
  }
  for (const tip of growth.tips) claim(tip.x, tip.y);
}

function restartGrowth() {
  if (mode !== 'grow') return;
  wake();
  release();
  if (growth?.segments.length) previousGrowth = growth;
  startGrowth();
  paused = false;
  debt = 0;
  updateControls();
  updateHint();
}

/* ===== поверхность роста ===== */

function growthSurface() {
  if (!growth.surface || growth.surfaceW !== Sx || growth.surfaceH !== Sy) {
    growth.surface = document.createElement('canvas');
    growth.surface.width = Math.round(Sx * dpr);
    growth.surface.height = Math.round(Sy * dpr);
    growth.surfaceW = Sx; growth.surfaceH = Sy;
    const g = growth.surface.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, Sx, Sy);
    for (const seg of growth.segments) strokeSegment(seg);
  }
  return growth.surface.getContext('2d');
}

function strokeSegment(seg) {
  const g = growthSurface();
  const Smin = Math.min(Sx, Sy);
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineWidth = Math.max(0.55, seg.width * Smin);
  g.beginPath();
  g.moveTo(seg.x1 * Sx, seg.y1 * Sy);
  g.lineTo(seg.x2 * Sx, seg.y2 * Sy);
  g.stroke();
}

/* ===== шаг ===== */

function growStep() {
  if (!growth) return;
  ensureGrid();
  const m = growth;
  if (m.done) return;
  m.time += STEP;
  if (on('auto')) {
    m.autoAt -= STEP;
    if (m.autoAt <= 0) {
      let x = 0.08 + Math.random() * 0.84;
      let y = 0.08 + Math.random() * 0.84;
      for (let tries = 0; tries < 20; tries += 1) {
        const k = at(x, y);
        if (k >= 0 && !walls[k] && inBounds(x, y)) break;
        x = 0.08 + Math.random() * 0.84;
        y = 0.08 + Math.random() * 0.84;
      }
      if (feed(x, y)) m.misses = 0; else m.misses += 1;
      m.autoAt = lerp(5, 0.3, (num('speed') - 1) / 15);
    }
  }
  for (const food of m.food) food.age += STEP;
  m.food = m.food.filter(f => f.age < FOOD_LIFE);

  const want = Math.round(4 + num('crowd') * 2);
  const sprouts = Math.random() < num('speed') / 16 ? 1 : 0;
  for (let i = 0; i < sprouts && m.tips.length < want; i += 1) {
    if (m.food.length) {
      const food = m.food[(Math.random() * m.food.length) | 0];
      sprout(food.x, food.y, true);
    } else if (on('auto') && m.segments.length) {
      const from = m.segments[(Math.random() * m.segments.length) | 0];
      sprout(from.x2, from.y2, true);
    }
  }

  const attempts = Math.min(1 + num('speed') * 4, m.tips.length * 2);
  for (let i = 0; i < attempts; i += 1) {
    const index = (Math.random() * m.tips.length) | 0;
    const tip = m.tips[index];
    if (!tip) continue;
    grow(tip, index);
  }
  /* Сажать больше некуда и живых кончиков нет — рост закончился. */
  if (m.tips.length === 0 && (m.misses >= 3 || !on('auto'))) m.idle += STEP;
  else m.idle = 0;
  if (m.idle > 1.5 && m.segments.length) {
    m.done = true;
    paused = true;
    updateControls();
  }
  if (m.segments.length > MAX_SEGMENTS) {
    m.segments.splice(0, m.segments.length - MAX_SEGMENTS);
  }
}

/* ===== рисование ===== */

function drawSVGOverlay() {
  if (!svgOverlay) return;
  const o = svgOverlay;
  const px = o.x * Sx, py = o.y * Sy;
  const pw = overlayWidth(o) * Sx, ph = o.h * Sy;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.filter = 'brightness(0) invert(1)';
  ctx.drawImage(o.img, px, py, pw, ph);
  ctx.restore();
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = Math.max(1, Math.min(Sx, Sy) * 0.002);
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(px, py, pw, ph);
  ctx.setLineDash([]);
}

function wallDraw() {
  ctx.drawImage(wallCanvas, 0, 0, Sx, Sy);
  if (svgOverlay) drawSVGOverlay();
  if (pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1 && !svgOverlay) {
    const Smin = Math.min(Sx, Sy);
    ctx.strokeStyle = brushErase ? RED : MUTED;
    ctx.lineWidth = Math.max(1, Smin * 0.002);
    ctx.beginPath();
    ctx.ellipse(pointer.x * Sx, pointer.y * Sy, brushRadius() * Sy, brushRadius() * Sy, 0, 0, TAU);
    ctx.stroke();
  }
}

function growDraw() {
  if (!growth) return;
  if (on('showWalls')) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(wallCanvas, 0, 0, Sx, Sy);
    ctx.restore();
  }
  growthSurface();
  ctx.drawImage(growth.surface, 0, 0, Sx, Sy);
  const Smin = Math.min(Sx, Sy);
  for (const food of growth.food) {
    const pulse = 0.012 + Math.sin(growth.time * 5 + food.age) * 0.002;
    ctx.beginPath();
    ctx.arc(food.x * Sx, food.y * Sy, pulse * Smin, 0, TAU);
    ctx.strokeStyle = food.age < 1 ? RED : MUTED;
    ctx.lineWidth = Math.max(1, Smin * 0.002);
    ctx.stroke();
  }
}

/* ===== экспорт =====
   И стены, и ветви хранятся векторно, поэтому снимок собирается заново
   в нужном размере и не зависит от окна. */

function exportSize() {
  const a = aspect();
  return a >= 1
    ? { w: EXPORT_LONG_SIDE, h: Math.round(EXPORT_LONG_SIDE / a) }
    : { w: Math.round(EXPORT_LONG_SIDE * a), h: EXPORT_LONG_SIDE };
}

function exportPNG() {
  const { w, h } = exportSize();
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const g = tmp.getContext('2d');
  g.save();
  clipField(g, w, h);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  const showW = mode === 'walls' || on('showWalls');
  if (showW && wallOps.length) {
    const layer = document.createElement('canvas');
    layer.width = w; layer.height = h;
    const lg = layer.getContext('2d');
    paintOps(lg, w, h, false);
    g.globalAlpha = mode === 'walls' ? 1 : 0.22;
    g.drawImage(layer, 0, 0);
    g.globalAlpha = 1;
  }
  if (mode === 'grow' && growth?.segments.length) {
    const minS = Math.min(w, h);
    g.strokeStyle = INK;
    g.lineCap = 'round';
    for (const seg of growth.segments) {
      g.lineWidth = Math.max(0.6, seg.width * minS);
      g.beginPath();
      g.moveTo(seg.x1 * w, seg.y1 * h);
      g.lineTo(seg.x2 * w, seg.y2 * h);
      g.stroke();
    }
  }
  g.restore();
  tmp.toBlob(blob => download(blob, 'png'));
}

function exportSVG() {
  const { w, h } = exportSize();
  const minS = Math.min(w, h);
  const showW = mode === 'walls' || on('showWalls');
  let defs = '';
  let body = '';
  if (showW && wallOps.length) {
    let mask = `<mask id="walls" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">`;
    for (const op of wallOps) {
      if (op.k === 'svg') {
        mask += `<image href="${op.src}" x="${(op.x * w).toFixed(2)}" y="${(op.y * h).toFixed(2)}"`
          + ` width="${(op.w * w).toFixed(2)}" height="${(op.h * h).toFixed(2)}"`
          + ' preserveAspectRatio="none" filter="url(#solid)"/>';
        continue;
      }
      const pts = op.pts.length === 1 ? [op.pts[0], op.pts[0]] : op.pts;
      const d = pts.map(p => `${(p[0] * w).toFixed(1)},${(p[1] * h).toFixed(1)}`).join(' ');
      mask += `<polyline points="${d}" fill="none" stroke="${op.erase ? '#000' : '#fff'}"`
        + ` stroke-width="${(op.r * 2 * h).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    mask += '</mask>';
    defs += '<filter id="solid" x="-10%" y="-10%" width="120%" height="120%">'
      + '<feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>';
    defs += mask;
    body += `<rect width="${w}" height="${h}" fill="${INK}" mask="url(#walls)" opacity="${mode === 'walls' ? 1 : 0.22}"/>`;
  }
  if (mode === 'grow' && growth?.segments.length) {
    const chains = new Map();
    for (const seg of growth.segments) {
      let chain = chains.get(seg.t);
      if (!chain) { chain = { width: seg.width, pts: [[seg.x1, seg.y1]] }; chains.set(seg.t, chain); }
      chain.pts.push([seg.x2, seg.y2]);
    }
    body += `<g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">`;
    for (const chain of chains.values()) {
      const d = chain.pts.map(p => `${(p[0] * w).toFixed(1)},${(p[1] * h).toFixed(1)}`).join(' ');
      body += `<polyline points="${d}" stroke-width="${Math.max(0.6, chain.width * minS).toFixed(2)}"/>`;
    }
    body += '</g>';
  }
  if (shape === 'oval') {
    defs += `<clipPath id="field"><ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}"/></clipPath>`;
  }
  const clip = shape === 'oval' ? ' clip-path="url(#field)"' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
    + (defs ? `<defs>${defs}</defs>` : '')
    + `<g${clip}><rect width="${w}" height="${h}" fill="${PAPER}"/>` + body + '</g></svg>';
  download(new Blob([svg], { type: 'image/svg+xml' }), 'svg');
}

function download(blob, ext) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grow-${Date.now()}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===== указатель ===== */

function track(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = (event.clientX - rect.left) / rect.width;
  pointer.y = (event.clientY - rect.top) / rect.height;
}

function svgHit(x, y) {
  if (!svgOverlay) return false;
  const o = svgOverlay;
  return x >= o.x && x <= o.x + overlayWidth(o) && y >= o.y && y <= o.y + o.h;
}

function down(event) {
  if (pointer.id !== null || (mode === 'grow' && paused && !growth?.done)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  track(event);
  if (pointer.x < 0 || pointer.x > 1 || pointer.y < 0 || pointer.y > 1) return;
  event.preventDefault();
  pointer.id = event.pointerId; pointer.down = true;
  canvas.setPointerCapture(event.pointerId);
  if (svgOverlay) {
    if (!svgHit(pointer.x, pointer.y)) return;
    svgOverlay.dragging = true;
    svgOverlay.grabDx = pointer.x - svgOverlay.x;
    svgOverlay.grabDy = pointer.y - svgOverlay.y;
    return;
  }
  if (mode === 'walls') {
    pushUndo();
    hasInteracted = true;
    wallDrawing = true;
    current = { k: 'b', erase: brushErase, r: brushRadius(), pts: [[pointer.x, pointer.y]] };
    wallOps.push(current);
    strokeLive([pointer.x, pointer.y], [pointer.x, pointer.y]);
    gridDirty = true;
    updateHint();
  } else {
    growth.leading = true;
    wake();
    feed(pointer.x, pointer.y);
  }
}

function move(event) {
  if (pointer.id !== null && pointer.id !== event.pointerId) return;
  track(event);
  if (svgOverlay && svgOverlay.dragging) {
    svgOverlay.x = clamp(pointer.x - svgOverlay.grabDx, -0.5, 1);
    svgOverlay.y = clamp(pointer.y - svgOverlay.grabDy, -0.5, 1);
    return;
  }
  if (mode === 'walls' && wallDrawing && current) {
    const prev = current.pts[current.pts.length - 1];
    const next = [pointer.x, pointer.y];
    if (Math.hypot(next[0] - prev[0], next[1] - prev[1]) < 0.0015) return;
    current.pts.push(next);
    strokeLive(prev, next);
    gridDirty = true;
  } else if (mode === 'grow' && pointer.down && growth) {
    if (growth.leading) {
      const trail = growth.trail;
      if (trail && distOf(trail[0], trail[1], pointer.x, pointer.y) < TRAIL_STEP) return;
      growth.trail = [pointer.x, pointer.y];
      feed(pointer.x, pointer.y);
    }
  }
}

function release(event) {
  if (event && event.pointerId !== pointer.id) return;
  const id = pointer.id;
  pointer.id = null; pointer.down = false;
  if (svgOverlay) svgOverlay.dragging = false;
  if (mode === 'walls') {
    wallDrawing = false;
    if (current) { current = null; updateGrowButton(); saveSoon(); }
  } else if (growth) { growth.trail = null; growth.leading = false; }
  if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}

function wheel(event) {
  if (svgOverlay) {
    event.preventDefault();
    track(event);
    scaleSVG(svgOverlay.h * (event.deltaY < 0 ? 1.1 : 1 / 1.1), pointer.x, pointer.y);
    return;
  }
  if (mode !== 'walls') return;
  event.preventDefault();
  setBrush(num('brush') + (event.deltaY < 0 ? 1 : -1));
}

function setBrush(size) {
  values.brush = clamp(Math.round(size), 2, 26);
  updateControls();
  saveSoon();
}

/* ===== клавиши ===== */

function key(event) {
  const node = event.target;
  if (event.key === 'Escape') {
    if (popover) { closePopover(); return; }
    if (svgOverlay) { cancelSVG(); return; }
    if (panelOpen) { panelOpen = false; updateControls(); fitCanvas(); saveSoon(); focusSettingsBtn(); return; }
    return;
  }
  if (node?.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.code === 'KeyZ' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (mode === 'walls') undoWalls();
    else if (previousGrowth) {
      release();
      growth = previousGrowth;
      previousGrowth = null;
      growth.surface = null;
      growth.done = false;
      rebuildGrowthMask();
      paused = true;
      debt = 0;
      updateControls();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.code === 'Space' && !node?.closest('button') && mode === 'grow') {
    event.preventDefault(); togglePause();
  }
  if (event.code === 'KeyR' && mode === 'grow') restartGrowth();
  if (event.code === 'KeyC' && mode === 'grow') {
    values.auto = false;
    updateControls();
    updateHint();
    saveSoon();
  }
}

/* ===== панель ===== */

const hintEl = document.getElementById('hint');

/* Холст центрируется в СВОБОДНОЙ части сцены, а не в сцене целиком.
   На широком экране колонка стоит в потоке, поэтому свободная часть получается сама.
   На телефоне лист лежит поверх — его высоту передают в occupied. */
function fitCanvas(occupied = 0) {
  const stage = document.getElementById('stage');
  const freeH = Math.max(80, stage.clientHeight - occupied);
  const k = Math.min(1, (stage.clientWidth - GUTTER * 2) / Sx, (freeH - GUTTER * 2) / Sy);
  const ty = -(stage.clientHeight - freeH) / 2;
  sheet.style.transform = `translateY(${ty.toFixed(1)}px) scale(${k.toFixed(4)})`;
}

/* ===== состояние интерфейса ===== */

function growthState() {
  if (mode === 'walls') return 'walls';
  if (growth?.done) return 'done';
  return paused ? 'paused' : 'running';
}

let railWide = true;
let panelOpen = true;

function uiState() {
  return {
    mode, tool: brushErase ? 'eraser' : 'brush', railWide, panelOpen,
    playing: !paused, auto: on('auto'), seeWalls: on('showWalls'),
    speed: num('speed'), canUndo: undoStack.length > 0, canGrow: wallsPresent || !!growth,
    placingSVG: !!svgOverlay, growthState: growthState(),
  };
}

let popover = null;

function closePopover() {
  popover?.remove();
  popover = null;
}

function openSavePopover() {
  if (popover) { closePopover(); return; }
  const anchors = [...document.querySelectorAll('#rail button.t[data-act="save"], #bar button.t[data-act="save"]')];
  const anchor = anchors.find(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || anchors[0];
  popover = document.createElement('div');
  popover.className = 'popover';
  popover.innerHTML = '<button data-fmt="png">PNG</button><button data-fmt="svg">SVG</button>';
  popover.addEventListener('click', e => {
    const f = e.target.dataset?.fmt;
    if (!f) return;
    closePopover();
    if (f === 'png') exportPNG(); else exportSVG();
  });
  document.querySelector('main').append(popover);
  const r = anchor.getBoundingClientRect();
  const m = document.querySelector('main').getBoundingClientRect();
  if (matchMedia('(max-width: 720px)').matches) {
    popover.style.left = '8px';
    popover.style.bottom = (m.bottom - r.top + 8) + 'px';
  } else {
    popover.style.left = (r.right - m.left + 8) + 'px';
    popover.style.top = (r.top - m.top) + 'px';
  }
}

document.addEventListener('pointerdown', e => {
  if (popover && !popover.contains(e.target) && !e.target.closest('#rail button.t, #bar button.t')) closePopover();
});

const actions = {
  setMode, setTool: t => { brushErase = t === 'eraser'; updateControls(); },
  undo: undoWalls, importSVG: () => document.getElementById('svg-file').click(),
  clearWalls, applySVG, cancelSVG, togglePause, restart: restartGrowth,
  setSpeed: v => { values.speed = v; updateControls(); saveSoon(); },
  toggleAuto: () => { values.auto = !values.auto; wake(); updateControls(); saveSoon(); },
  toggleWalls: () => { values.showWalls = !values.showWalls; updateControls(); saveSoon(); },
  togglePanel: () => {
    panelOpen = !panelOpen;
    updateControls(true);
    fitCanvas();
    saveSoon();
    if (!panelOpen) focusSettingsBtn();
  },
  save: () => openSavePopover(),
  toggleRail: () => { railWide = !railWide; updateControls(true); fitCanvas(); saveSoon(); },
  setValue: (key, v) => {
    values[key] = v;
    if (key === 'gap') rebuildGrowthMask();
    wake(); saveSoon();
  },
  /* Смена формы — по клику, не по протяжке: полная пересборка колонки здесь
     уместна и нужна, чтобы подсветка кнопки и пересчёт холста не разошлись. */
  setShape: s => { applyField(s, proportion); values.shape = shape; resize(); rebuildWallCanvas(); updateGrowButton(); updateControls(true); saveSoon(); },
  /* Пропорция меняется протяжкой ползунка: полная пересборка колонки здесь
     вырвала бы фокус из-под курсора, поэтому подпись обновляет сам ui.js. */
  setProportion: p => { applyField(shape, p); values.proportion = proportion; resize(); rebuildWallCanvas(); updateGrowButton(); updateControls(); saveSoon(); },
  applyPreset: name => { Object.assign(values, PRESETS[name]); rebuildGrowthMask(); wake(); updateControls(true); saveSoon(); },
  resetGrowth: () => { for (const k of GROWTH_KEYS) values[k] = DEFAULTS[k]; rebuildGrowthMask(); wake(); updateControls(true); saveSoon(); },
  setSVGScale: pct => {
    const o = svgOverlay;
    if (!o) return;
    scaleSVG(o.baseH * pct / 100, o.x + overlayWidth(o) / 2, o.y + o.h / 2);
  },
};

/* Пересборка рейки и колонки убивает фокус и рвёт перетаскивание ползунков
   (темп, панельные range), поэтому от полной пересборки защищаемся подписью
   структуры: значения (speed и прочие values.*) в неё не входят — движение
   ползунка обновляет только число рядом с ним через patchTempo(). */
let lastSig = '';
function updateControls(force = false) {
  const s = uiState();
  const note = document.getElementById('note');
  note.textContent = svgOverlay
    ? 'размещение SVG'
    : { walls: 'рисование', running: 'растёт', paused: 'на паузе', done: 'готово' }[growthState()];
  const narrow = matchMedia('(max-width: 720px)').matches;
  const sig = [s.mode, s.tool, s.railWide, s.panelOpen, s.placingSVG,
               s.canUndo, s.canGrow, s.growthState, s.auto, s.seeWalls, narrow].join('|');
  if (!force && sig === lastSig) { patchTempo(s); return; }
  lastSig = sig;
  buildRail(document.getElementById('rail'), s, actions);
  document.getElementById('col').className = 'col' + (panelOpen ? ' open' : '');
  buildSettings(document.getElementById('colIn'), mode, values, actions, svgOverlay);

  if (narrow) {
    buildBar(document.getElementById('bar'), s, actions);
    const ms = document.getElementById('msheet');
    ms.className = 'msheet settings' + (panelOpen ? ' open' : '');
    buildSettings(ms, mode, values, actions, svgOverlay);
    if (mode === 'grow') ms.prepend(tempoField());
    buildQuick(ms, s, actions);
    requestAnimationFrame(() => fitCanvas(panelOpen ? ms.offsetHeight : 0));
  } else {
    fitCanvas();
  }
}

/* Закрытие колонки клавишей или кнопкой не должно ронять фокус на body:
   рейка перестраивается заново, поэтому ищем кнопку уже после сборки. */
function focusSettingsBtn() {
  document.querySelector('#rail button[data-act="settings"]')?.focus();
}

function patchTempo(s) {
  const num = document.querySelector('#rail .tempo .num');
  if (num) num.textContent = `${s.speed}×`;
}

/* Ползунок темпа в мобильном листе: как field() в ui.js, обновляет
   собственную подпись из своего же обработчика — patchTempo его не видит. */
function tempoField() {
  const l = document.createElement('label');
  l.className = 'field';
  l.innerHTML = `<span>темп · ${num('speed')}</span>`
    + `<input type="range" min="1" max="16" step="1" value="${num('speed')}">`;
  const cap = l.querySelector('span'), input = l.querySelector('input');
  input.addEventListener('input', () => {
    cap.textContent = `темп · ${input.value}`;
    actions.setSpeed(Number(input.value));
  });
  return l;
}

function setMode(newMode) {
  if (svgOverlay && newMode === 'grow') {
    showMessage('Сначала примените SVG или отмените его размещение.');
    return;
  }
  if (newMode === mode) return;
  ensureGrid();
  if (newMode === 'grow' && !wallsPresent && !growth) return;
  release();
  mode = newMode;
  if (newMode === 'grow' && !growth) {
    values.showWalls = false;
    values.auto = true;
    startGrowth();
  }
  debt = 0;
  updateControls(true);
  updateHint();
}

function updateHint() {
  if (svgOverlay) {
    hintEl.hidden = true;
    return;
  }
  if (mode === 'walls' && !hasInteracted) {
    hintEl.hidden = false;
    hintEl.textContent = 'нарисуйте стены — вокруг них пойдёт рост';
    return;
  }
  ensureGrid();
  if (mode === 'walls' && wallsPresent && !growth) {
    hintEl.hidden = false;
    hintEl.textContent = 'готово — включите «рост» слева';
    return;
  }
  hintEl.hidden = true;
}

function updateGrowButton() {
  ensureGrid();
  updateControls();
  updateHint();
}

/* ===== сохранение ===== */

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

function save() {
  try {
    const ops = wallOps.map(op => op.k === 'svg'
      ? { k: 'svg', src: op.src, x: op.x, y: op.y, w: op.w, h: op.h }
      : { k: 'b', erase: op.erase, r: Number(op.r.toFixed(5)), pts: op.pts.map(p => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))]) });
    localStorage.setItem(STORE_KEY, JSON.stringify({ values, ops, ui: { railWide, panelOpen } }));
  } catch {
    /* переполнение хранилища — рисунок просто не переживёт перезагрузку */
  }
}

function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
  if (!saved) return;
  /* Разовый перенос: именованные форматы превратились в форму и пропорцию. */
  const OLD_FORMATS = { 'квадрат': 0, 'широко': 0.42, 'высоко': -0.42, 'лист': 0.32 };
  if (saved.values && typeof saved.values.format === 'string') {
    saved.values.proportion = OLD_FORMATS[saved.values.format] ?? 0;
    saved.values.shape = 'rect';
    delete saved.values.format;
  }
  for (const k of Object.keys(DEFAULTS)) {
    if (saved.values && k in saved.values) values[k] = saved.values[k];
  }
  if (saved.ui) {
    railWide = saved.ui.railWide !== false;
    panelOpen = saved.ui.panelOpen !== false;
  }
  applyField(values.shape, values.proportion);
  wallOps = (saved.ops || []).filter(op => op.k === 'svg' ? op.src : op.pts?.length);
  if (wallOps.length) hasInteracted = true;
  gridDirty = true;
  let pending = 0;
  for (const op of wallOps) {
    if (op.k !== 'svg') continue;
    pending += 1;
    const img = new Image();
    img.onload = img.onerror = () => {
      op.img = img.complete && img.naturalWidth ? img : null;
      pending -= 1;
      gridDirty = true;
      if (pending === 0) { rebuildWallCanvas(); updateGrowButton(); }
    };
    img.src = op.src;
  }
  /* Холст экрана пересобирает resize() ниже по инициализации — здесь он
     всё равно ещё в размере по умолчанию, пересобирать дважды незачем. */
  if (!pending) updateGrowButton();
}

/* ===== события ===== */

document.getElementById('svg-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadSVG(file);
  e.target.value = '';
});

canvas.addEventListener('dragover', e => e.preventDefault());
canvas.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.type === 'image/svg+xml' || file.name.endsWith('.svg'))) loadSVG(file);
});
canvas.addEventListener('wheel', wheel, { passive: false });
canvas.addEventListener('pointerdown', down);
canvas.addEventListener('pointermove', move);
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('pointerleave', () => { if (!pointer.down) { pointer.x = -1; pointer.y = -1; } });
document.addEventListener('keydown', key);
window.addEventListener('blur', () => release());

function togglePause() {
  if (mode !== 'grow') return;
  release();
  paused = !paused;
  debt = 0;
  updateControls();
}

function wake() {
  if (!growth?.done) return;
  growth.done = false;
  growth.idle = 0;
  growth.misses = 0;
  paused = false;
  updateControls();
}

/* ===== размер ===== */

const GUTTER = 14;
const RAIL_MIN = 50;

/* Растр считается от максимума: рейка свёрнута, колонка закрыта.
   Всё остальное — только масштаб показа, без пересчёта и перерисовки узора. */
function resize() {
  const main = document.querySelector('main');
  const W = Math.max(40, main.clientWidth - RAIL_MIN - GUTTER * 2);
  const H = Math.max(40, main.clientHeight - GUTTER * 2);
  const a = aspect();
  if (W / H > a) { Sy = H; Sx = Sy * a; }
  else { Sx = W; Sy = Sx / a; }
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(Sx * dpr);
  canvas.height = Math.round(Sy * dpr);
  canvas.style.width = Sx + 'px';
  canvas.style.height = Sy + 'px';
  canvas.style.borderRadius = shape === 'oval' ? '50%' : '0';
  rebuildWallCanvas();
  fitCanvas();
}

/* ===== главный цикл ===== */

function frame(now) {
  debt = paused || document.hidden ? 0 : Math.min(0.1, debt + (now - last) / 1000);
  last = now;
  while (debt >= STEP) {
    if (mode !== 'walls') growStep();
    debt -= STEP;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, Sx, Sy);
  ctx.save();
  clipField(ctx, Sx, Sy);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, Sx, Sy);
  if (mode === 'walls') wallDraw();
  else growDraw();
  ctx.restore();
  requestAnimationFrame(frame);
}

/* ===== инициализация ===== */

/* ===== полоса на телефоне: долгий тап на кисти/ластике открывает размер ===== */

let holdTimer = 0;
let holdFired = false;
document.getElementById('bar').addEventListener('pointerdown', e => {
  holdFired = false;
  const b = e.target.closest('button.t');
  if (!b || !/кисть|ластик/.test(b.title)) return;
  holdTimer = setTimeout(() => {
    holdFired = true;
    const pop = document.getElementById('brushpop');
    pop.classList.add('open');
    pop.querySelector('input').value = num('brush');
    document.getElementById('bpval').textContent = num('brush');
  }, 450);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  document.getElementById('bar').addEventListener(ev, () => clearTimeout(holdTimer));
}
/* Перехват в фазе захвата: успевает раньше клик-обработчика кнопки,
   который иначе после долгого тапа ещё и переключит инструмент. */
document.getElementById('bar').addEventListener('click', e => {
  if (holdFired) { e.stopPropagation(); e.preventDefault(); }
}, true);
document.getElementById('brushpop').addEventListener('input', e => {
  actions.setValue('brush', Number(e.target.value));
  document.getElementById('bpval').textContent = e.target.value;
});
document.addEventListener('pointerdown', e => {
  const pop = document.getElementById('brushpop');
  if (pop.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('#bar')) {
    pop.classList.remove('open');
  }
});

applyField(values.shape, values.proportion);
load();
setBrush(values.brush);
/* Уведомления ResizeObserver приходят уже после requestAnimationFrame того же
   кадра, поэтому голый fitCanvas() здесь переписал бы верный отступ под лист
   нулём — пересчитываем отступ так же, как updateControls(). */
new ResizeObserver(() => {
  const narrow = matchMedia('(max-width: 720px)').matches;
  fitCanvas(narrow && panelOpen ? document.getElementById('msheet').offsetHeight : 0);
}).observe(document.getElementById('stage'));
addEventListener('resize', resize);
/* resize() уже пересчитывает холст при любом ресайзе окна, но подпись sig
   в updateControls() перестраивает оболочку только при пересечении границы
   720px, а не на каждый пиксель — слушаем именно смену медиазапроса. */
matchMedia('(max-width: 720px)').addEventListener('change', () => updateControls(true));
resize();
updateControls();
updateGrowButton();
requestAnimationFrame(frame);
