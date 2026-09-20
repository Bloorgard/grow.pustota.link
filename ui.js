/* Сборка интерфейса. Модуль ничего не знает о состоянии приложения:
   всё приходит объектами state и actions. Импортирует только field.js. */
import { shape, proportion, ratioLabel } from './field.js';

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
    root.append(caption('разместить SVG'));
    root.append(button('check', 'применить SVG', { on: true, click: a.applySVG }));
    root.append(button('undo', 'отменить SVG', { ghost: true, key: 'Esc', click: a.cancelSVG }));
  } else if (s.mode === 'walls') {
    root.append(caption('инструмент'));
    root.append(button('brush', 'кисть', { on: s.tool === 'brush', click: () => a.setTool('brush') }));
    root.append(button('eraser', 'ластик', { on: s.tool === 'eraser', click: () => a.setTool('eraser') }));
    root.append(rule());
    root.append(button('undo', 'отменить', { ghost: true, key: '⌘Z', disabled: !s.canUndo, click: a.undo }));
    root.append(button('svg', 'вставить SVG', { ghost: true, click: a.importSVG }));
    root.append(button('clear', 'очистить', { ghost: true, click: a.clearWalls }));
  } else {
    root.append(caption('воспроизведение'));
    const done = s.growthState === 'done';
    root.append(button(s.playing && !done ? 'pause' : 'play',
      done ? 'готово' : s.playing ? 'пауза' : 'продолжить',
      { key: '␣', disabled: done, click: a.togglePause }));
    root.append(button('restart', 'заново', { ghost: true, key: 'R', click: a.restart }));
    root.append(tempo(s, a));
    root.append(rule());
    root.append(caption('показ'));
    root.append(button('auto', 'растить само', { on: s.auto, key: 'C', click: a.toggleAuto }));
    root.append(button(s.seeWalls ? 'eye' : 'eye-off', 'показывать стены', { on: s.seeWalls, click: a.toggleWalls }));
  }

  const sp = document.createElement('div');
  sp.className = 'spacer';
  root.append(sp);
  root.append(button('settings', 'настройки', { on: s.panelOpen, click: a.togglePanel }));
  root.append(button('save', 'сохранить', { ghost: true, act: 'save', click: a.save }));
  root.append(rule());
  root.append(button(s.railWide ? 'fold' : 'unfold', s.railWide ? 'свернуть' : 'развернуть',
    { ghost: true, click: a.toggleRail }));
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

export function buildSettings(root, mode, values, a, svg) {
  root.innerHTML = '';

  /* Размещение SVG — отдельное состояние колонки: пока оно идёт,
     остальные настройки не нужны и только мешают. */
  if (svg) {
    root.insertAdjacentHTML('beforeend', '<h3>разместить SVG</h3>');
    const l = document.createElement('label');
    l.className = 'field';
    const pct = Math.round(svg.h / svg.baseH * 100);
    l.innerHTML = `<span>масштаб · ${pct}%</span>`
      + `<input type="range" min="10" max="500" step="1" value="${pct}">`;
    l.querySelector('input').addEventListener('input', e => a.setSVGScale(Number(e.target.value)));
    root.append(l);
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
    const p = document.createElement('label');
    p.className = 'field';
    p.innerHTML = `<span>пропорция · ${ratioLabel()}</span>`
      + `<input type="range" min="-1" max="1" step="0.05" value="${proportion}">`;
    const pCap = p.querySelector('span'), pInput = p.querySelector('input');
    pInput.addEventListener('input', e => {
      a.setProportion(Number(e.target.value));
      pCap.textContent = `пропорция · ${ratioLabel()}`;
    });
    root.append(p);
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
