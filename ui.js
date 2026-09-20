/* Сборка интерфейса. Модуль ничего не знает о состоянии приложения:
   всё приходит объектами state и actions. Импортирует только field.js. */
import { shape, proportion, ratioLabel, aspect } from './field.js';

export function icon(name) {
  return `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function button(name, label, o = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 't' + (o.on ? ' on' : '') + (o.ghost ? ' ghost' : '');
  b.title = label + (o.key ? ` (${o.key})` : '');
  if (o.act) b.dataset.act = o.act;
  b.disabled = !!o.disabled;
  if (o.on !== undefined) b.setAttribute('aria-pressed', String(!!o.on));
  b.innerHTML = icon(name) + `<span class="lbl">${label}</span>` + (o.key ? `<span class="k">${o.key}</span>` : '');
  if (o.click) b.addEventListener('click', o.click);
  return b;
}

function caption(word) {
  const d = document.createElement('div');
  d.className = 'cap';
  d.innerHTML = `<i></i><b>${word}</b>`;
  return d;
}

function rule() { return document.createElement('hr'); }

export function buildRail(root, s, a) {
  root.className = 'rail' + (s.railWide ? ' wide' : '');
  root.innerHTML = '';
  root.append(caption('режим'));
  root.append(button('walls', 'стены', { on: s.mode === 'walls', click: () => a.setMode('walls') }));
  root.append(button('grow', 'рост', { on: s.mode === 'grow', disabled: !s.canGrow, click: () => a.setMode('grow') }));
  root.append(rule());

  if (s.placingSVG) {
    root.append(caption('разместить картинку'));
    root.append(button('check', 'применить', { on: true, click: a.applySVG }));
    root.append(button('undo', 'отменить', { ghost: true, key: 'Esc', click: a.cancelSVG }));
  } else if (s.mode === 'walls') {
    root.append(caption('инструмент'));
    root.append(button('brush', 'кисть', { on: s.tool === 'brush', click: () => a.setTool('brush') }));
    root.append(button('eraser', 'ластик', { on: s.tool === 'eraser', click: () => a.setTool('eraser') }));
    root.append(button('hand', 'двигать', { on: s.tool === 'hand', click: () => a.setTool('hand') }));
    root.append(rule());
    root.append(button('undo', 'отменить', { ghost: true, key: '⌘Z', disabled: !s.canUndo, click: a.undo }));
    root.append(button('svg', 'вставить картинку', { ghost: true, key: '⌘V', click: a.importSVG }));
    root.append(button('clear', 'очистить', { ghost: true, click: a.clearWalls }));
  } else {
    root.append(caption('воспроизведение'));
    const done = s.growthState === 'done';
    root.append(button(s.playing && !done ? 'pause' : 'play',
      done ? 'готово' : s.playing ? 'пауза' : 'продолжить',
      { key: '␣', disabled: done, click: a.togglePause }));
    /* Подпись контекстная: в авто очистка и правда запускает заново,
       в ручном она просто стирает — и говорит об этом. */
    root.append(button('restart', s.auto ? 'заново' : 'очистить рост',
      { ghost: true, key: 'R', click: a.restart }));
    root.append(tempo(s, a));
    root.append(rule());
    root.append(caption('источник'));
    root.append(button('auto', 'авто-рост', { on: s.auto, key: 'C', click: () => a.setAuto(true) }));
    root.append(button('brush', 'вручную', { on: !s.auto, click: () => a.setAuto(false) }));
    root.append(rule());
    root.append(caption('показ'));
    root.append(button(s.seeWalls ? 'eye' : 'eye-off', 'показывать стены', { on: s.seeWalls, click: a.toggleWalls }));
  }

  const sp = document.createElement('div');
  sp.className = 'spacer';
  root.append(sp);
  root.append(button('settings', 'настройки', { on: s.panelOpen, act: 'settings', click: a.togglePanel }));
  root.append(button('save', 'сохранить', { ghost: true, act: 'save', click: a.save }));
  root.append(rule());
  root.append(button(s.railWide ? 'fold' : 'unfold', s.railWide ? 'свернуть' : 'развернуть',
    { ghost: true, click: a.toggleRail }));
}

/* ===== полоса инструментов (узкий экран) ===== */

export function buildBar(root, s, a) {
  root.innerHTML = '';
  const seg = document.createElement('div');
  seg.className = 'modeseg';
  for (const [m, name] of [['walls', 'walls'], ['grow', 'grow']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = s.mode === m ? 'on' : '';
    b.title = m === 'walls' ? 'стены' : 'рост';
    b.disabled = m === 'grow' && !s.canGrow;
    b.innerHTML = icon(name);
    b.addEventListener('click', () => a.setMode(m));
    seg.append(b);
  }
  root.append(seg);

  const tools = document.createElement('div');
  tools.className = 'tools';
  const add = (n, l, o) => tools.append(barButton(n, l, o));
  if (s.placingSVG) {
    add('check', 'применить', { on: true, click: a.applySVG });
    add('undo', 'отменить', { ghost: true, click: a.cancelSVG });
  } else if (s.mode === 'walls') {
    add('brush', 'кисть', { on: s.tool === 'brush', click: () => a.setTool('brush') });
    add('eraser', 'ластик', { on: s.tool === 'eraser', click: () => a.setTool('eraser') });
    add('hand', 'двигать', { on: s.tool === 'hand', click: () => a.setTool('hand') });
    add('undo', 'отменить', { ghost: true, disabled: !s.canUndo, click: a.undo });
  } else {
    const done = s.growthState === 'done';
    add(s.playing && !done ? 'pause' : 'play', done ? 'готово' : 'пауза', { disabled: done, click: a.togglePause });
    add('restart', s.auto ? 'заново' : 'очистить рост', { ghost: true, click: a.restart });
    add('auto', s.auto ? 'авто-рост' : 'вручную', { on: s.auto, click: () => a.setAuto(!s.auto) });
  }
  root.append(tools);
  root.append(barButton('settings', 'настройки', { on: s.panelOpen, act: 'settings', click: a.togglePanel }));
  root.append(barButton('save', 'сохранить', { ghost: true, act: 'save', click: a.save }));
}

function barButton(name, label, o = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 't' + (o.on ? ' on' : '') + (o.ghost ? ' ghost' : '');
  b.title = label;
  if (o.act) b.dataset.act = o.act;
  b.disabled = !!o.disabled;
  b.innerHTML = icon(name) + `<span class="lbl">${label}</span>`;
  if (o.click) b.addEventListener('click', o.click);
  return b;
}

/* Ряд редких команд наверху мобильного листа — им не хватило места в полосе. */
export function buildQuick(root, s, a) {
  const row = document.createElement('div');
  row.className = 'quick';
  if (s.mode === 'walls') {
    row.innerHTML = `<button data-q="svg">${icon('svg')}вставить картинку</button>`
      + `<button data-q="clear">${icon('clear')}очистить</button>`;
  } else {
    row.innerHTML = `<button data-q="eye">${icon(s.seeWalls ? 'eye' : 'eye-off')}стены</button>`;
  }
  row.addEventListener('click', e => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q === 'svg') a.importSVG();
    if (q === 'clear') a.clearWalls();
    if (q === 'eye') a.toggleWalls();
  });
  root.prepend(row);
}

/* В компактной рейке ползунка не видно, поэтому строка работает кнопкой:
   разворачивает рейку и отдаёт фокус ползунку, чтобы управление не было мёртвым. */
function tempo(s, a) {
  const row = document.createElement('div');
  row.className = 'tempo';
  row.innerHTML = `<span class="num">${s.speed}×</span>`
    + `<input type="range" min="1" max="16" step="1" value="${s.speed}" aria-label="Темп">`;
  row.querySelector('input').addEventListener('input', e => a.setSpeed(Number(e.target.value)));
  row.addEventListener('click', e => {
    if (s.railWide || e.target.tagName === 'INPUT') return;
    a.toggleRail();
    requestAnimationFrame(() => document.querySelector('.tempo input')?.focus());
  });
  return row;
}

/* ===== колонка настроек =====
   Постоянная колонка вместо временной панели: три честные группы параметров
   роста, форма холста иконками, пресеты в подвал. */

const COARSE = matchMedia('(pointer: coarse)').matches;

function field(label, key, value, min, max, step, a) {
  const l = document.createElement('label');
  l.className = 'field';
  l.dataset.key = key;
  l.innerHTML = `<span>${label} · ${value}</span>`
    + `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  const cap = l.querySelector('span'), input = l.querySelector('input');
  input.addEventListener('input', () => {
    cap.textContent = `${label} · ${input.value}`;
    a.setValue(key, Number(input.value));
  });
  return l;
}

const GROUPS = {
  заселение: [
    ['побегов за касание', 'seeds', 1, 14, 1],
    ['плотность побегов', 'crowd', 0, 30, 1],
    ['тяга к касанию', 'pull', 0, 2, 0.05],
  ],
  движение: [
    ['извив', 'wander', 0.2, 2.5, 0.1],
    ['прямизна', 'straight', 0, 1, 0.02],
    ['ветвление', 'branch', 0, 8, 1],
    ['жизнь побега', 'life', 0.5, 6, 0.5],
  ],
  линия: [
    ['толщина ветвей', 'mass', 1, 8, 1],
    ['просвет', 'gap', 0.002, 0.03, 0.001],
    ['длина шага', 'step', 0.003, 0.03, 0.001],
  ],
};

/* Иконки формы живут в той же пропорции, что и холст: ползунок тянут,
   квадратик вместе с ним вытягивается. Бокс кнопки при этом не меняется. */
function sizeShapeIcons(root) {
  const ar = aspect();
  const w = ar >= 1 ? 18 : 18 * ar;
  const h = ar >= 1 ? 18 / ar : 18;
  for (const i of root.querySelectorAll('.fmt i')) {
    i.style.width = `${w.toFixed(1)}px`;
    i.style.height = `${h.toFixed(1)}px`;
  }
}

export function buildSettings(root, mode, values, a, svg) {
  root.innerHTML = '';

  /* Размещение SVG — отдельное состояние колонки: пока оно идёт,
     остальные настройки не нужны и только мешают. */
  if (svg) {
    root.insertAdjacentHTML('beforeend', '<h3>разместить картинку</h3>');
    const l = document.createElement('label');
    l.className = 'field';
    const pct = Math.round(svg.h / svg.baseH * 100);
    l.dataset.key = 'svgscale';
    l.innerHTML = `<span>масштаб · ${pct}%</span>`
      + `<input type="range" min="10" max="500" step="1" value="${pct}">`;
    const scaleCap = l.querySelector('span'), scaleInput = l.querySelector('input');
    scaleInput.addEventListener('input', e => {
      a.setSVGScale(Number(e.target.value));
      scaleCap.textContent = `масштаб · ${e.target.value}%`;
    });
    root.append(l);

    /* Автомат ошибается на пограничных картинках, поэтому переключатель
       виден всегда: им и включают порог, и отказываются от него. */
    const bin = document.createElement('button');
    bin.type = 'button';
    bin.className = 't ghost wide-btn' + (svg.binary ? ' on' : '');
    bin.innerHTML = icon('contrast') + '<span class="lbl">два тона</span>';
    bin.addEventListener('click', a.toggleBinary);
    root.append(bin);

    if (svg.binary) {
      const th = document.createElement('label');
      th.className = 'field';
      th.dataset.key = 'threshold';
      th.innerHTML = `<span>порог · ${svg.threshold}%</span>`
        + `<input type="range" min="0" max="100" step="1" value="${svg.threshold}">`;
      const thCap = th.querySelector('span'), thInput = th.querySelector('input');
      thInput.addEventListener('input', e => {
        a.setThreshold(Number(e.target.value));
        thCap.textContent = `порог · ${e.target.value}%`;
      });
      root.append(th);

      const bl = document.createElement('label');
      bl.className = 'field';
      bl.dataset.key = 'blur';
      bl.innerHTML = `<span>сглаживание · ${svg.blur}</span>`
        + `<input type="range" min="0" max="10" step="1" value="${svg.blur}">`;
      const blCap = bl.querySelector('span'), blInput = bl.querySelector('input');
      blInput.addEventListener('input', e => {
        a.setBlur(Number(e.target.value));
        blCap.textContent = `сглаживание · ${e.target.value}`;
      });
      root.append(bl);

      const inv = document.createElement('button');
      inv.type = 'button';
      inv.className = 't ghost wide-btn' + (svg.invert ? ' on' : '');
      inv.innerHTML = icon('invert') + '<span class="lbl">инвертировать</span>';
      inv.addEventListener('click', a.toggleInvert);
      root.append(inv);
    }
    return;
  }

  if (mode === 'walls') {
    root.insertAdjacentHTML('beforeend', '<h3>кисть</h3>');
    root.append(field(COARSE ? 'размер (долгий тап)' : 'размер (колесо)', 'brush', values.brush, 2, 26, 1, a));
    root.insertAdjacentHTML('beforeend', '<h3>холст</h3>'
      + `<div class="fmt">
           <button data-shape="rect" class="${shape === 'rect' ? 'on' : ''}" title="прямоугольник"><i class="rect"></i></button>
           <button data-shape="oval" class="${shape === 'oval' ? 'on' : ''}" title="овал"><i class="oval"></i></button>
         </div>`);
    root.querySelectorAll('[data-shape]').forEach(b =>
      b.addEventListener('click', () => a.setShape(b.dataset.shape)));
    sizeShapeIcons(root);
    const p = document.createElement('label');
    p.className = 'field';
    p.innerHTML = `<span>пропорция · ${ratioLabel()}</span>`
      + `<input type="range" min="-1" max="1" step="0.05" value="${proportion}">`;
    const pCap = p.querySelector('span'), pInput = p.querySelector('input');
    pInput.addEventListener('input', e => {
      a.setProportion(Number(e.target.value));
      pCap.textContent = `пропорция · ${ratioLabel()}`;
      sizeShapeIcons(root);
    });
    root.append(p);

    root.insertAdjacentHTML('beforeend', '<h3>рисунок</h3>');
    const sc = document.createElement('label');
    sc.className = 'field';
    sc.dataset.key = 'drawscale';
    sc.innerHTML = '<span>масштаб · 100%</span>'
      + '<input type="range" min="50" max="200" step="1" value="100">';
    const scCap = sc.querySelector('span'), scInput = sc.querySelector('input');
    scInput.addEventListener('input', e => {
      a.setDrawScale(Number(e.target.value));
      scCap.textContent = `масштаб · ${e.target.value}%`;
    });
    /* Отпустил — изменение запечено, ползунок возвращается в 100%. */
    scInput.addEventListener('change', a.commitDrawScale);
    root.append(sc);
    return;
  }

  root.insertAdjacentHTML('beforeend', '<h3>заселение</h3>'
    + `<div class="seg">${['у стен', 'у нароста', 'везде']
        .map((t, i) => `<button data-sow="${i}" class="${values.sow === i ? 'on' : ''}" aria-pressed="${values.sow === i}">${t}</button>`).join('')}</div>`);
  root.querySelectorAll('[data-sow]').forEach(b =>
    b.addEventListener('click', () => {
      a.setValue('sow', Number(b.dataset.sow));
      root.querySelectorAll('[data-sow]').forEach(x => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
    }));

  for (const [title, rows] of Object.entries(GROUPS)) {
    if (title !== 'заселение') root.insertAdjacentHTML('beforeend', `<h3>${title}</h3>`);
    for (const [label, key, min, max, step] of rows) root.append(field(label, key, values[key], min, max, step, a));
  }

  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.innerHTML = '<h3 style="margin-top:0">пресет</h3>'
    + `<div class="presets">${['мох', 'иней', 'плети', 'корни']
        .map(n => `<button data-preset="${n}">${n}</button>`).join('')}</div>`
    + `<button type="button" class="t ghost wide-btn">${icon('restart')}<span class="lbl">сбросить параметры</span></button>`;
  foot.querySelectorAll('[data-preset]').forEach(b =>
    b.addEventListener('click', () => a.applyPreset(b.dataset.preset)));
  foot.querySelector('.wide-btn').addEventListener('click', a.resetGrowth);
  root.append(foot);
}
