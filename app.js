/* grow.pustota.link — обрастание вокруг пользовательских стен и SVG.
   Механика роста из буквы Ю (alphabet.pustota.link), режим «обрастание».
   Правки: стены рисует пользователь, SVG-источник, экспорт, отмена, размер холста. */

const GRID = 420;
const INK = '#f1ede5';
const PAPER = '#161616';
const RED = '#e0210f';
const MUTED = 'rgba(241,237,229,.45)';
const FAINT = 'rgba(241,237,229,.12)';
const STEP = 1 / 60;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const FOOD_LIFE = 17;
const TRAIL_STEP = 0.06;
const MAX_TIPS = 520;
const MAX_SEGMENTS = 160000;
const EDGE = 0.035;
const ASPECTS = { 'квадрат': 1, 'широко': 4 / 3, 'высоко': 3 / 4, 'лист': 5 / 4 };

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = 600, H = 600, Sx = 600, Sy = 600, ox = 0, oy = 0, dpr = 1;
let frameId = 0, last = performance.now(), debt = 0;
let paused = false;
let mode = 'walls';

let walls = new Uint8Array(GRID * GRID);
let wallDirty = true;
const wallCanvas = document.createElement('canvas');
wallCanvas.width = GRID; wallCanvas.height = GRID;
const wallHistory = [];
const MAX_UNDO = 30;

let brushSize = 6;
let brushErase = false;
let wallDrawing = false;
let lastWall = null;

/* SVG-оверлей: загруженная SVG как перегородки, с позиционированием. */
let svgOverlay = null;
let svgPlacing = false;
window.svgOverlay = svgOverlay;
window.svgPlacing = svgPlacing;

const pointer = { x: 0.5, y: 0.5, id: null, down: false, px: 0.5, py: 0.5 };
let growth = null;

const values = {
  auto: true, showWalls: false,
  speed: 8, mass: 5, branch: 5, seeds: 7, crowd: 12,
  sow: 1, gap: 0.007, step: 0.009,
  wander: 1, straight: 0.14, pull: 0.55, life: 3,
  format: 'квадрат', brush: 6,
};
const num = key => Number(values[key]);
const on = key => !!values[key];

/* ===== координаты ===== */

function at(x, y) {
  const ix = Math.floor(x * GRID);
  const iy = Math.floor(y * GRID);
  return ix < 0 || iy < 0 || ix >= GRID || iy >= GRID ? -1 : iy * GRID + ix;
}

function open(x, y) { return x > EDGE && x < 1 - EDGE && y > EDGE && y < 1 - EDGE; }

/* ===== стены: кисть, отмена ===== */

function snapshotWalls() {
  wallHistory.push(new Uint8Array(walls));
  if (wallHistory.length > MAX_UNDO) wallHistory.shift();
}

function undoWalls() {
  if (!wallHistory.length) return;
  walls = wallHistory.pop();
  wallDirty = true;
}

function paintWall(x, y) {
  const r = brushSize;
  const ci = Math.round(x * GRID);
  const cj = Math.round(y * GRID);
  for (let j = cj - r; j <= cj + r; j += 1) {
    for (let i = ci - r; i <= ci + r; i += 1) {
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      walls[j * GRID + i] = brushErase ? 0 : 1;
    }
  }
  wallDirty = true;
}

function paintWallLine(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist * GRID));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    paintWall(x0 + dx * t, y0 + dy * t);
  }
}

function renderWallCanvas() {
  const g = wallCanvas.getContext('2d');
  const img = g.createImageData(GRID, GRID);
  for (let i = 0; i < GRID * GRID; i += 1) {
    if (walls[i]) {
      const k = i * 4;
      img.data[k] = 241; img.data[k + 1] = 237; img.data[k + 2] = 229; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  wallDirty = false;
}

function loadSVG(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || 300;
      const ih = img.naturalHeight || 300;
      /* Начальный масштаб: вписать в 60% холста, центрировать. */
      const fitScale = Math.min(0.6 / (iw / GRID), 0.6 / (ih / GRID));
      const dw = iw * fitScale, dh = ih * fitScale;
      svgOverlay = {
        img, w: iw, h: ih,
        x: (GRID - dw) / 2 / GRID,
        y: (GRID - dh) / 2 / GRID,
        scale: fitScale,
        dragging: false, grabDx: 0, grabDy: 0,
      };
      svgPlacing = true;
      window.svgOverlay = svgOverlay;
      window.svgPlacing = svgPlacing;
      updateHint();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* Применить SVG-оверлей: растеризовать в walls. */
function applySVG() {
  if (!svgOverlay) return;
  const { img, x, y, scale, w, h } = svgOverlay;
  const dw = w * scale, dh = h * scale;
  const dx = x * GRID, dy = y * GRID;
  const tmp = document.createElement('canvas');
  tmp.width = GRID; tmp.height = GRID;
  const g = tmp.getContext('2d');
  g.drawImage(img, dx, dy, dw, dh);
  const data = g.getImageData(0, 0, GRID, GRID).data;
  snapshotWalls();
  for (let i = 0; i < GRID * GRID; i += 1) {
    if (data[i * 4 + 3] > 32) walls[i] = 1;
  }
  wallDirty = true;
  svgOverlay = null;
  svgPlacing = false;
  window.svgOverlay = null;
  window.svgPlacing = false;
  updateHint();
}

function cancelSVG() {
  svgOverlay = null;
  svgPlacing = false;
  window.svgOverlay = null;
  window.svgPlacing = false;
  updateHint();
}

function hasWalls() {
  for (let i = 0; i < walls.length; i += 1) if (walls[i]) return true;
  return false;
}

/* ===== рост ===== */

function claim(x, y) {
  const r = Math.max(1, Math.round(num('gap') * GRID));
  const ci = Math.round(x * GRID), cj = Math.round(y * GRID);
  for (let j = cj - r; j <= cj + r; j += 1) {
    for (let i = ci - r; i <= ci + r; i += 1) {
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      growth.grown[j * GRID + i] = 1;
    }
  }
}

function nearWall(x, y, wallsOnly) {
  const ix = Math.floor(x * GRID), iy = Math.floor(y * GRID);
  const reach = Math.max(2, Math.round(GRID * (num('gap') + 0.008)));
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const px = ix + dx, py = iy + dy;
      if (px < 0 || py < 0 || px >= GRID || py >= GRID) continue;
      const key = py * GRID + px;
      if (walls[key] || (!wallsOnly && growth.grown[key])) return true;
    }
  }
  return false;
}

function nearWallOnly(x, y) {
  const ix = Math.floor(x * GRID), iy = Math.floor(y * GRID);
  const reach = Math.max(2, Math.round(GRID * (num('gap') + 0.008)));
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const px = ix + dx, py = iy + dy;
      if (px >= 0 && py >= 0 && px < GRID && py < GRID && walls[py * GRID + px]) return true;
    }
  }
  return false;
}

function sprout(x, y, anyWall = false) {
  if (!anyWall) {
    let closest = null;
    for (let iy = 0; iy < GRID; iy += 1) {
      for (let ix = 0; ix < GRID; ix += 1) {
        if (!walls[iy * GRID + ix]) continue;
        const px = (ix + 0.5) / GRID, py = (iy + 0.5) / GRID;
        const distance = (px - x) ** 2 + (py - y) ** 2;
        if (!closest || distance < closest.distance) closest = { x: px, y: py, distance };
      }
    }
    if (!closest) return;
    x = closest.x; y = closest.y;
  }
  for (let n = 0; n < 900; n += 1) {
    const wide = n > 300;
    const a = Math.random() * TAU;
    const r = 0.01 + Math.random() * (wide ? 0.5 : 0.045);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    const key = at(px, py);
    if (key < 0 || !open(px, py) || walls[key] || growth.grown[key]) continue;
    const where = num('sow');
    if (where === 0 && !nearWallOnly(px, py)) continue;
    if (where === 1 && !nearWall(px, py, false)) continue;
    claim(px, py);
    const aim = anyWall ? a : Math.atan2(y - py, x - px);
    growth.tips.push({ x: px, y: py, a: aim, age: 0, life: (70 + Math.random() * 190) * num('life') });
    return;
  }
}

function feed(x, y) {
  if (!open(x, y)) return;
  if (nearWall(x, y, false)) {
    for (let i = 0; i < num('seeds'); i += 1) sprout(x, y, true);
  }
  growth.food.push({ x, y, age: 0 });
  if (growth.food.length > 9) growth.food.shift();
  for (let i = 0; i < num('seeds'); i += 1) sprout(x, y);
}

function grow(tip, index) {
  let best = null;
  for (let trial = 0; trial < 14; trial += 1) {
    const spread = trial < 7 ? 1.75 : TAU;
    const a = tip.a + (Math.random() - 0.5) * spread * num('wander');
    const step = Math.max(num('step'), num('gap') * 1.35);
    const x = tip.x + Math.cos(a) * step, y = tip.y + Math.sin(a) * step;
    const key = at(x, y);
    if (key < 0 || !open(x, y) || walls[key] || growth.grown[key]) continue;
    let pull = Math.cos(a - tip.a) * num('straight');
    for (const food of growth.food) {
      const target = Math.atan2(food.y - tip.y, food.x - tip.x);
      const distance = Math.hypot(food.x - tip.x, food.y - tip.y);
      pull += Math.cos(a - target) * num('pull') / (0.08 + distance * 2.2);
    }
    if (!best || pull > best.pull) best = { x, y, a, pull };
  }
  if (!best || tip.age > tip.life) { growth.tips.splice(index, 1); return; }
  claim(best.x, best.y);
  const mass = num('mass');
  const segment = {
    x1: tip.x, y1: tip.y, x2: best.x, y2: best.y, born: growth.time,
    width: 0.0014 + mass * 0.00055 + Math.random() * mass * 0.00025,
  };
  growth.segments.push(segment);
  strokeSegment(segment);
  tip.x = best.x; tip.y = best.y; tip.a = best.a; tip.age += 1;
  if (Math.random() < num('branch') * 0.012 && growth.tips.length < MAX_TIPS) {
    growth.tips.push({
      x: tip.x, y: tip.y, a: tip.a + (Math.random() - 0.5) * 1.4,
      age: tip.age, life: tip.life * (0.55 + Math.random() * 0.35),
    });
  }
}

function startGrowth() {
  growth = {
    grown: new Uint8Array(GRID * GRID),
    tips: [], segments: [], food: [],
    time: 0, autoAt: 0.35, trail: null, leading: false,
    surface: null, surfaceW: 0, surfaceH: 0,
  };
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
  const m = growth;
  m.time += STEP;
  if (on('auto')) {
    m.autoAt -= STEP;
    if (m.autoAt <= 0) {
      let x = 0.08 + Math.random() * 0.84;
      let y = 0.08 + Math.random() * 0.84;
      for (let tries = 0; tries < 20; tries += 1) {
        const k = at(x, y);
        if (k >= 0 && !walls[k]) break;
        x = 0.08 + Math.random() * 0.84;
        y = 0.08 + Math.random() * 0.84;
      }
      feed(x, y);
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
    const at = (Math.random() * m.tips.length) | 0;
    const tip = m.tips[at];
    if (!tip) continue;
    grow(tip, at);
  }
  if (m.segments.length > MAX_SEGMENTS) {
    m.segments.splice(0, m.segments.length - MAX_SEGMENTS);
  }
}

/* ===== рисование ===== */

function drawCanvasFrame() {
  ctx.strokeStyle = 'rgba(241,237,229,0.18)';
  ctx.lineWidth = Math.max(1, Math.min(Sx, Sy) * 0.004);
  ctx.strokeRect(0, 0, Sx, Sy);
}

function drawOnboarding() {
  if (mode !== 'walls' || hasWalls() || svgPlacing) return;
  const Smin = Math.min(Sx, Sy);
  ctx.fillStyle = 'rgba(241,237,229,0.2)';
  ctx.font = `500 ${Math.round(Smin * 0.04)}px 'PT Sans', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('рисуйте здесь', Sx / 2, Sy / 2);
  ctx.textAlign = 'left';
}

function drawSVGOverlay() {
  if (!svgOverlay) return;
  const { img, x, y, scale, w, h } = svgOverlay;
  const dw = w * scale, dh = h * scale;
  const dx = x * GRID, dy = y * GRID;
  const px = dx / GRID * Sx;
  const py = dy / GRID * Sy;
  const pw = dw / GRID * Sx;
  const ph = dh / GRID * Sy;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(img, px, py, pw, ph);
  ctx.restore();
  /* Рамка вокруг SVG. */
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = Math.max(1, Math.min(Sx, Sy) * 0.002);
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(px, py, pw, ph);
  ctx.setLineDash([]);
}

function wallDraw() {
  if (wallDirty) renderWallCanvas();
  if (hasWalls()) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(wallCanvas, 0, 0, Sx, Sy);
    ctx.imageSmoothingEnabled = true;
  }
  if (svgOverlay) drawSVGOverlay();
  drawCanvasFrame();
  drawOnboarding();
  if (pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1 && !svgPlacing) {
    const r = brushSize / GRID;
    const Smin = Math.min(Sx, Sy);
    ctx.strokeStyle = brushErase ? RED : MUTED;
    ctx.lineWidth = Math.max(1, Smin * 0.002);
    ctx.beginPath();
    ctx.arc(pointer.x * Sx, pointer.y * Sy, r * Smin, 0, TAU);
    ctx.stroke();
  }
}

function growDraw() {
  if (!growth) return;
  if (on('showWalls')) {
    if (wallDirty) renderWallCanvas();
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.imageSmoothingEnabled = false;
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
  drawCanvasFrame();
}

/* ===== экспорт ===== */

function exportPNG() {
  const tmp = document.createElement('canvas');
  tmp.width = Math.round(Sx * dpr);
  tmp.height = Math.round(Sy * dpr);
  const g = tmp.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, Sx, Sy);
  g.save();
  g.beginPath(); g.rect(0, 0, Sx, Sy); g.clip();
  if (mode === 'walls') {
    if (wallDirty) renderWallCanvas();
    g.imageSmoothingEnabled = false;
    g.drawImage(wallCanvas, 0, 0, Sx, Sy);
  } else {
    if (on('showWalls')) {
      g.save();
      g.globalAlpha = 0.22;
      g.imageSmoothingEnabled = false;
      g.drawImage(wallCanvas, 0, 0, Sx, Sy);
      g.restore();
    }
    if (growth && growth.surface) {
      growthSurface();
      g.drawImage(growth.surface, 0, 0, Sx, Sy);
    }
  }
  g.restore();
  tmp.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `grow-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function exportSVG() {
  const SCALE = 1000;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCALE} ${SCALE}" width="${SCALE}" height="${SCALE}">`;
  svg += `<rect width="${SCALE}" height="${SCALE}" fill="${PAPER}"/>`;
  if (on('showWalls') && hasWalls()) {
    const cell = SCALE / GRID;
    svg += '<g fill="' + INK + '" opacity="0.22">';
    for (let j = 0; j < GRID; j += 1) {
      for (let i = 0; i < GRID; i += 1) {
        if (walls[j * GRID + i]) {
          svg += `<rect x="${(i * cell).toFixed(2)}" y="${(j * cell).toFixed(2)}" width="${(cell + 0.5).toFixed(2)}" height="${(cell + 0.5).toFixed(2)}"/>`;
        }
      }
    }
    svg += '</g>';
  }
  if (growth && growth.segments.length) {
    svg += '<g stroke="' + INK + '" stroke-linecap="round">';
    for (const seg of growth.segments) {
      const w = Math.max(0.5, seg.width * SCALE);
      svg += `<line x1="${(seg.x1 * SCALE).toFixed(2)}" y1="${(seg.y1 * SCALE).toFixed(2)}" x2="${(seg.x2 * SCALE).toFixed(2)}" y2="${(seg.y2 * SCALE).toFixed(2)}" stroke-width="${w.toFixed(3)}"/>`;
    }
    svg += '</g>';
  }
  svg += '</svg>';
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `grow-${Date.now()}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===== указатель ===== */

function track(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.px = pointer.x; pointer.py = pointer.y;
  pointer.x = (event.clientX - rect.left) / rect.width;
  pointer.y = (event.clientY - rect.top) / rect.height;
}

function svgHit(x, y) {
  if (!svgOverlay) return false;
  const { x: sx, y: sy, scale, w, h } = svgOverlay;
  const dw = w * scale / GRID, dh = h * scale / GRID;
  return x >= sx && x <= sx + dw && y >= sy && y <= sy + dh;
}

function down(event) {
  if (pointer.id !== null || paused) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  track(event);
  if (pointer.x < 0 || pointer.x > 1 || pointer.y < 0 || pointer.y > 1) return;
  event.preventDefault();
  pointer.id = event.pointerId; pointer.down = true;
  canvas.setPointerCapture(event.pointerId);
  if (svgPlacing && svgHit(pointer.x, pointer.y)) {
    svgOverlay.dragging = true;
    svgOverlay.grabDx = pointer.x - svgOverlay.x;
    svgOverlay.grabDy = pointer.y - svgOverlay.y;
    return;
  }
  if (mode === 'walls') {
    snapshotWalls();
    wallDrawing = true;
    lastWall = { x: pointer.x, y: pointer.y };
    paintWall(pointer.x, pointer.y);
  } else {
    growth.leading = true;
    feed(pointer.x, pointer.y);
  }
}

function move(event) {
  if (pointer.id !== null && pointer.id !== event.pointerId) return;
  track(event);
  if (svgPlacing && svgOverlay && svgOverlay.dragging) {
    svgOverlay.x = clamp(pointer.x - svgOverlay.grabDx, -0.5, 1);
    svgOverlay.y = clamp(pointer.y - svgOverlay.grabDy, -0.5, 1);
    return;
  }
  if (mode === 'walls' && wallDrawing) {
    if (lastWall) paintWallLine(lastWall.x, lastWall.y, pointer.x, pointer.y);
    lastWall = { x: pointer.x, y: pointer.y };
  } else if (mode === 'grow' && pointer.down && growth) {
    if (growth.leading) {
      const trail = growth.trail;
      if (trail && Math.hypot(pointer.x - trail[0], pointer.y - trail[1]) < TRAIL_STEP) return;
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
  if (mode === 'walls') { wallDrawing = false; lastWall = null; }
  else if (growth) { growth.trail = null; growth.leading = false; }
  if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}

function wheel(event) {
  if (!svgPlacing || !svgOverlay) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  const { x, y, scale, w, h } = svgOverlay;
  /* Масштаб вокруг центра указателя. */
  const cx = pointer.x, cy = pointer.y;
  const dw = w * scale / GRID, dh = h * scale / GRID;
  const newScale = clamp(scale * factor, 0.02, 4);
  const newDw = w * newScale / GRID, newDh = h * newScale / GRID;
  svgOverlay.x = cx - (cx - x) * (newScale / scale);
  svgOverlay.y = cy - (cy - y) * (newScale / scale);
  svgOverlay.scale = newScale;
}

function key(event) {
  const node = event.target;
  if (node && node.closest && node.closest('input, textarea, select')) return;
  if (event.key === 'Tab') { event.preventDefault(); togglePanel(); }
  if (event.code === 'Space' && !(node && node.closest && node.closest('button'))) {
    event.preventDefault(); togglePause();
  }
  if (event.code === 'KeyZ' && (event.ctrlKey || event.metaKey) && mode === 'walls') { event.preventDefault(); undoWalls(); }
  if (event.code === 'KeyR' && mode === 'grow') startGrowth();
  if (event.code === 'KeyC' && mode === 'grow') { values.auto = false; startGrowth(); }
}

/* ===== панель ===== */

const panel = document.getElementById('panel');
const toggleBtn = document.getElementById('toggle');
const hintEl = document.getElementById('hint');
let panelTarget = panel;

function togglePanel() {
  panel.hidden = !panel.hidden;
  toggleBtn.hidden = !panel.hidden;
}
toggleBtn.addEventListener('click', togglePanel);

function makeRange(key, label, min, max, step) {
  const el = document.createElement('label');
  const caption = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step;
  input.value = values[key];
  const paint = () => { caption.textContent = `${label} · ${values[key]}`; };
  input.addEventListener('input', () => {
    values[key] = Number(input.value);
    if (key === 'brush') brushSize = Number(input.value);
    paint();
    if (key === 'gap') startGrowth();
  });
  paint(); el.append(caption, input); panelTarget.append(el);
}

function makeToggle(key, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const paint = () => { btn.textContent = `${label} · ${values[key] ? 'да' : 'нет'}`; };
  btn.addEventListener('click', () => { values[key] = !values[key]; paint(); });
  paint(); panelTarget.append(btn);
}

function makePick(key, label, options) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const getIdx = () => typeof values[key] === 'number' ? values[key] : options.indexOf(values[key]);
  const paint = () => { btn.textContent = `${label} · ${options[getIdx()]}`; };
  btn.addEventListener('click', () => {
    const idx = getIdx();
    const next = (idx + 1) % options.length;
    values[key] = typeof values[key] === 'number' ? next : options[next];
    paint();
    if (key === 'format') resize();
  });
  paint(); panelTarget.append(btn);
}

function makeButton(text, action) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = text;
  btn.addEventListener('click', action);
  panelTarget.append(btn);
}

function makeToolButton(label, active, action) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = label;
  btn.className = active ? 'tool-active' : '';
  btn.addEventListener('click', action);
  return btn;
}

function hr() { const h = document.createElement('hr'); panel.append(h); }

function makeSection(title, collapsed = false) {
  const wrap = document.createElement('div');
  wrap.className = 'section' + (collapsed ? ' collapsed' : '');
  const head = document.createElement('div');
  head.className = 'section-head';
  head.textContent = title;
  const body = document.createElement('div');
  body.className = 'section-body';
  head.addEventListener('click', () => {
    wrap.classList.toggle('collapsed');
  });
  wrap.append(head, body);
  panel.append(wrap);
  panelTarget = body;
  return body;
}

function endSection() { panelTarget = panel; }

function buildPanel() {
  panel.innerHTML = '';
  panelTarget = panel;
  if (svgPlacing) {
    makeButton('применить SVG', applySVG);
    makeButton('отменить SVG', cancelSVG);
    return;
  }
  if (mode === 'walls') {
    /* кисть / ластик — две кнопки в ряд */
    makeRange('brush', 'кисть', 2, 20, 1);
    const toolRow = document.createElement('div');
    toolRow.className = 'tool-row';
    const brushBtn = makeToolButton('кисть', !brushErase, () => { brushErase = false; buildPanel(); });
    const eraseBtn = makeToolButton('ластик', brushErase, () => { brushErase = true; buildPanel(); });
    toolRow.append(brushBtn, eraseBtn);
    panelTarget.append(toolRow);
    hr();
    makeButton('отменить ⌘Z', undoWalls);
    makeButton('очистить стены', () => { snapshotWalls(); walls.fill(0); wallDirty = true; });
    hr();
    makePick('format', 'формат', ['квадрат', 'широко', 'высоко', 'лист']);
    const svgLabel = document.createElement('button');
    svgLabel.type = 'button'; svgLabel.textContent = 'загрузить SVG';
    svgLabel.addEventListener('click', () => document.getElementById('svg-file').click());
    panelTarget.append(svgLabel);
  } else {
    makeToggle('auto', 'автономно');
    makeToggle('showWalls', 'перегородки');
    makeSection('рост');
    makeRange('speed', 'скорость', 1, 16, 1);
    makeRange('mass', 'масса', 1, 8, 1);
    makeRange('branch', 'ветвление', 0, 8, 1);
    makeRange('seeds', 'очагов', 1, 14, 1);
    makeRange('crowd', 'поголовье', 0, 30, 1);
    makePick('sow', 'засев', ['у стен', 'у нароста', 'повсюду']);
    endSection();
    makeSection('форма', true);
    makeRange('gap', 'просвет', 0.002, 0.03, 0.001);
    makeRange('step', 'звено', 0.003, 0.03, 0.001);
    makeRange('wander', 'извив', 0.2, 2.5, 0.1);
    makeRange('straight', 'прямизна', 0, 1, 0.02);
    makeRange('pull', 'тяга к еде', 0, 2, 0.05);
    makeRange('life', 'жизнь', 0.5, 6, 0.5);
    endSection();
    makeSection('управление');
    makeButton('заново (r)', () => { values.auto = true; startGrowth(); });
    makeButton('вручную (c)', () => { values.auto = false; startGrowth(); });
    makeButton('пауза (пробел)', togglePause);
    endSection();
    makeSection('сохранить');
    makeButton('PNG', exportPNG);
    makeButton('SVG', exportSVG);
    endSection();
  }
}

/* ===== переключение режимов ===== */

function setMode(newMode) {
  if (newMode === 'grow' && !hasWalls() && !svgPlacing) {
    hintEl.textContent = 'сначала нарисуйте стены или загрузите SVG';
    return;
  }
  if (newMode === 'grow' && svgPlacing) cancelSVG();
  mode = newMode;
  for (const btn of document.querySelectorAll('#modes button')) {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  }
  if (newMode === 'grow') {
    values.showWalls = true;
    startGrowth();
  }
  pointer.down = false; pointer.id = null;
  wallDrawing = false; lastWall = null;
  buildPanel();
  updateHint();
}

function updateHint() {
  if (svgPlacing) hintEl.textContent = 'тяните, чтобы переместить · колесо — масштаб · «применить SVG»';
  else if (mode === 'walls') hintEl.textContent = 'нарисуйте стены — потом «рост» обрастёт вокруг них';
  else hintEl.textContent = 'коснитесь — питание, рост идёт следом';
}

document.querySelectorAll('#modes button').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

document.getElementById('svg-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadSVG(file);
  e.target.value = '';
});

/* Drag-and-drop SVG на холст. */
canvas.addEventListener('dragover', (e) => { e.preventDefault(); });
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.type === 'image/svg+xml' || file.name.endsWith('.svg'))) {
    loadSVG(file);
  }
});

canvas.addEventListener('wheel', wheel, { passive: false });

function togglePause() { paused = !paused; debt = 0; }

/* ===== resize ===== */

function resize() {
  const main = canvas.parentElement;
  W = main.clientWidth; H = main.clientHeight;
  const a = ASPECTS[values.format] || 1;
  if (W / H > a) { Sy = H; Sx = Sy * a; }
  else { Sx = W; Sy = Sx / a; }
  ox = (W - Sx) / 2; oy = (H - Sy) / 2;
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(Sx * dpr);
  canvas.height = Math.round(Sy * dpr);
  canvas.style.width = Sx + 'px';
  canvas.style.height = Sy + 'px';
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
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, Sx, Sy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, Sx, Sy);
  ctx.clip();
  if (mode === 'walls') wallDraw();
  else growDraw();
  ctx.restore();
  frameId = requestAnimationFrame(frame);
}

/* ===== инициализация ===== */

const observer = new ResizeObserver(resize);
observer.observe(canvas.parentElement);
resize();
buildPanel();
updateHint();

canvas.addEventListener('pointerdown', down);
canvas.addEventListener('pointermove', move);
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);
document.addEventListener('keydown', key);
window.addEventListener('blur', () => release());

frameId = requestAnimationFrame(frame);
