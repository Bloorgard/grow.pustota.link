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
  root.append(button('save', 'сохранить', { ghost: true, click: a.save }));
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
