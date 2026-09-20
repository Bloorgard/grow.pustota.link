# Пересборка интерфейса grow.pustota.link — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ ПОД-НАВЫК: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans, чтобы выполнять план задача за задачей. Шаги размечены чекбоксами (`- [ ]`).

**Цель:** заменить шапку, док и плавающую панель на рейку с колонкой настроек, форматы холста — на форму и пропорцию, бесконечный рост — на конечный, по спеке `docs/superpowers/specs/2026-09-20-grow-interface-redesign-design.md`.

**Архитектура:** из `app.js` выделяются два модуля — `field.js` (форма поля, пропорция, сетка столкновений, границы, координатные помощники) и `ui.js` (сборка рейки, колонки и мобильной полосы). Зависимости односторонние: `field.js` ничего не импортирует, `ui.js` импортирует только `field.js` и получает действия объектом-колбэком, `app.js` импортирует оба. Циклов нет. Остальное — стены, рост, экспорт, хранилище, главный цикл — остаётся в `app.js`.

**Стек:** статика без сборки, нативные ES-модули, Canvas 2D, vanilla JS, CSS без препроцессора.

## Общие ограничения

- **Тестового раннера в проекте нет и он не добавляется.** Проверка каждой задачи: `node --check` для синтаксиса плюс скриптовая проверка в браузере с конкретными ожидаемыми значениями. Критерий «прошло / не прошло» указан в каждом шаге проверки.
- **Локальный сервер обязан отдавать `Cache-Control: no-store`.** Без этого браузер держит старый `app.js` и проверки врут — это уже случалось. Скрипт сервера: `docs/superpowers/plans/serve.py` (создаётся в задаче 1).
- Открывать проверки по адресу `http://127.0.0.1:8777/`.
- **Язык интерфейса — русский, строчными буквами**, как во всём проекте: `стены`, `рост`, `растить само`. Заголовки разделов — заглавными средствами CSS (`text-transform: uppercase`), не в разметке.
- **Никаких CDN и пакетов.** Иконки вкладываются инлайновым `<symbol>`-спрайтом.
- Цвета берутся из существующих CSS-переменных: `--bg: #161616`, `--stage: #0b0b0a`, `--fg: #f1ede5`, `--muted: #aaa79f`, `--panel: #1c1c1b`, `--border: #393936`, `--edge: #4d4d48`, `--red: #e0210f`.
- Кривая движения — `cubic-bezier(.2,.7,.2,1)`, хранится в `--ease`. Базовая длительность — `--t: .18s`.
- `GRID_BASE = 420`, `EDGE = 0.035`, `EXPORT_LONG_SIDE = 2048` — не менять.
- Коммиты на ветке `redesign/rail-and-growth`, сообщения по-русски, с `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Задача 1: `field.js` — форма поля, пропорция, сетка

Выносим геометрию в отдельный модуль и заменяем именованные форматы на форму плюс пропорцию. Старый интерфейс после этой задачи продолжает работать: пикер формата в панели временно превращается в две кнопки формы и один ползунок.

**Файлы:**
- Создать: `field.js`
- Создать: `docs/superpowers/plans/serve.py`
- Изменить: `app.js` (удалить `ASPECTS`, `AR`, `GX`, `GY`, `at`, `inBounds`, `setGrid`, `dxOf`, `dyOf`, `angleTo`, `distOf`; импортировать их из `field.js`; переписать `buildPanel` в части формата; перенос старого формата в `load`)

**Интерфейсы:**
- Отдаёт наружу: `GRID_BASE`, `EDGE`, `shape`, `proportion`, `AR`, `GX`, `GY`, `setField(shape, proportion)`, `aspect()`, `ratioLabel()`, `at(x,y)`, `inBounds(x,y)`, `dxOf(a,len)`, `dyOf(a,len)`, `angleTo(x0,y0,x1,y1)`, `distOf(x0,y0,x1,y1)`, `clipField(g,PW,PH)`
- `shape: 'rect' | 'oval'`, `proportion: number` в `[-1, 1]`, `AR/GX/GY: number` — живые привязки, меняются только через `setField`

- [ ] **Шаг 1: Создать сервер для проверок**

```python
# docs/superpowers/plans/serve.py
import http.server, socketserver, os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
print('http://127.0.0.1:8777/', flush=True)
socketserver.TCPServer(('', 8777), H).serve_forever()
```

- [ ] **Шаг 2: Создать `field.js`**

```js
/* Форма поля, пропорция и сетка столкновений.
   Модуль ничего не импортирует: он самый нижний слой. */

export const GRID_BASE = 420;
export const EDGE = 0.035;

export let shape = 'rect';
export let proportion = 0;
export let AR = 1;
export let GX = GRID_BASE;
export let GY = GRID_BASE;

export const aspect = () => 2 ** proportion;

/* Пропорция и форма меняются только здесь: GX, GY и AR пересчитываются разом,
   иначе сетка и координаты разъезжаются. */
export function setField(nextShape, nextProportion) {
  shape = nextShape === 'oval' ? 'oval' : 'rect';
  proportion = Math.max(-1, Math.min(1, Number(nextProportion) || 0));
  AR = aspect();
  GX = Math.max(1, Math.round(GRID_BASE * AR));
  GY = GRID_BASE;
}

export function ratioLabel() {
  const a = aspect();
  const near = x => Math.abs(a - x) < 0.02;
  if (Math.abs(proportion) < 0.03) return '1 : 1';
  if (near(Math.SQRT2)) return '√2 : 1 · A4 альбом';
  if (near(1 / Math.SQRT2)) return '1 : √2 · A4 портрет';
  return a >= 1 ? `${a.toFixed(2)} : 1` : `1 : ${(1 / a).toFixed(2)}`;
}

export function at(x, y) {
  const ix = Math.floor(x * GX);
  const iy = Math.floor(y * GY);
  return ix < 0 || iy < 0 || ix >= GX || iy >= GY ? -1 : iy * GX + ix;
}

/* Граница поля. Для овала — эллипс, вписанный в те же поля, что и прямоугольник.
   Побеги отказываются шагнуть наружу и загибаются вдоль края. */
export function inBounds(x, y) {
  const mx = EDGE / AR;
  if (shape === 'oval') {
    const dx = (x - 0.5) / (0.5 - mx);
    const dy = (y - 0.5) / (0.5 - EDGE);
    return dx * dx + dy * dy < 1;
  }
  return x > mx && x < 1 - mx && y > EDGE && y < 1 - EDGE;
}

/* Обрезка по форме листа: используется в главном цикле и в экспорте PNG. */
export function clipField(g, PW, PH) {
  g.beginPath();
  if (shape === 'oval') g.ellipse(PW / 2, PH / 2, PW / 2, PH / 2, 0, 0, Math.PI * 2);
  else g.rect(0, 0, PW, PH);
  g.clip();
}

/* Длины задаются в долях высоты; по горизонтали делим на пропорцию,
   чтобы шаг был одинаковым в пикселях по обеим осям. */
export const dxOf = (a, len) => Math.cos(a) * len / AR;
export const dyOf = (a, len) => Math.sin(a) * len;
export const angleTo = (x0, y0, x1, y1) => Math.atan2(y1 - y0, (x1 - x0) * AR);
export const distOf = (x0, y0, x1, y1) => Math.hypot((x1 - x0) * AR, y1 - y0);
```

- [ ] **Шаг 3: Проверить, что модуль считает пропорцию верно**

Запустить: `node --input-type=module -e "import('./field.js').then(f=>{f.setField('rect',0.5);console.log(f.AR.toFixed(3),f.GX,f.ratioLabel());f.setField('oval',0);console.log(f.inBounds(0.5,0.5),f.inBounds(0.02,0.02));})"`

Ожидается ровно:
```
1.414 594 √2 : 1 · A4 альбом
true false
```

Смысл второй строки: центр круглого поля внутри, угол квадрата — снаружи. Если `f.inBounds(0.02,0.02)` вернул `true`, эллиптическая ветка не работает.

- [ ] **Шаг 4: Убрать геометрию из `app.js`**

Удалить из `app.js` строки с `ASPECTS`, `let AR`, `let GX, GY`, функции `at`, `inBounds`, `setGrid`, константы `dxOf`, `dyOf`, `angleTo`, `distOf`, `GRID_BASE`, `EDGE`. Вместо них в начало файла добавить:

```js
import {
  GRID_BASE, EDGE, AR, GX, GY, shape, proportion,
  setField, aspect, ratioLabel, at, inBounds, clipField,
  dxOf, dyOf, angleTo, distOf,
} from './field.js';
```

Заменить тело `setGrid` на функцию в `app.js`, которая вызывает `setField` и переаллоцирует массивы:

```js
function applyField(nextShape, nextProportion) {
  setField(nextShape, nextProportion);
  walls = new Uint8Array(GX * GY);
  gridDirty = true;
  if (growth) {
    growth.grown = new Uint8Array(GX * GY);
    rebuildGrowthMask();
  }
}
```

- [ ] **Шаг 5: Заменить формат на форму и пропорцию в параметрах**

В `DEFAULTS` убрать `format: 'квадрат'`, добавить `shape: 'rect'` и `proportion: 0`. В `exportSize()` и `resize()` заменить `ASPECTS[values.format] || 1` на `aspect()`.

В `buildPanel()` в ветке `mode === 'walls'` заменить `makePick('format', ...)` на две кнопки формы и ползунок:

```js
makePick('shape', 'форма холста', ['прямоугольник', 'овал'], () => {
  applyField(values.shape === 'овал' ? 'oval' : 'rect', values.proportion);
  resize(); rebuildWallCanvas(); updateGrowButton();
});
makeRange('proportion', 'пропорция', -1, 1, 0.05);
```

**Это временная заглушка на одну задачу** — в задаче 5 она заменяется на иконки формы и подпись `ratioLabel()`. Цель сейчас — чтобы приложение осталось рабочим.

- [ ] **Шаг 6: Перенести уже сохранённые форматы**

В `load()`, сразу после чтения `saved`, добавить перед циклом по `DEFAULTS`:

```js
/* Разовый перенос: именованные форматы превратились в форму и пропорцию. */
const OLD_FORMATS = { 'квадрат': 0, 'широко': 0.42, 'высоко': -0.42, 'лист': 0.32 };
if (saved.values && typeof saved.values.format === 'string') {
  saved.values.proportion = OLD_FORMATS[saved.values.format] ?? 0;
  saved.values.shape = 'rect';
  delete saved.values.format;
}
```

В конце `load()` заменить вызов `setGrid()` на `applyField(values.shape, values.proportion)`.

- [ ] **Шаг 7: Проверить синтаксис и работу в браузере**

Запустить: `node --check app.js && node --check field.js`
Ожидается: пусто, код возврата 0.

Запустить сервер `python3 docs/superpowers/plans/serve.py`, открыть `http://127.0.0.1:8777/`, выполнить в консоли страницы:

```js
localStorage.setItem('grow.pustota.v1', JSON.stringify({values:{format:'широко'},ops:[]}));
location.reload();
```

После перезагрузки выполнить:

```js
const c = document.getElementById('canvas');
({ ratio: (parseFloat(c.style.width)/parseFloat(c.style.height)).toFixed(2),
   stored: JSON.parse(localStorage.getItem('grow.pustota.v1')).values.proportion })
```

Ожидается: `ratio` равен `"1.34"`, `stored` равен `0.42`. Это значит, что старый «широко» перенесён в пропорцию и холст встал в ту же пропорцию, что и раньше.

Проверить, что в консоли нет ошибок.

- [ ] **Шаг 8: Коммит**

```bash
git add field.js app.js docs/superpowers/plans/serve.py
git commit -m "Форма и пропорция вместо именованных форматов, геометрия в field.js

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 2: овал — граница роста, обрезка, прозрачный PNG

**Файлы:**
- Изменить: `app.js` (`frame`, `wallDraw`, `growDraw`, `exportPNG`, `exportSVG`, `rebuildWallCanvas`)

**Интерфейсы:**
- Берёт из задачи 1: `clipField(g, PW, PH)`, `shape`, `inBounds(x, y)`
- Отдаёт дальше: ничего нового, меняется поведение существующих функций

- [ ] **Шаг 1: Обрезать главный цикл по форме**

В `frame()` заменить блок заливки и клипа:

```js
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, Sx, Sy);
  ctx.save();
  clipField(ctx, Sx, Sy);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, Sx, Sy);
  if (mode === 'walls') wallDraw();
  else growDraw();
  ctx.restore();
```

`clearRect` вместо `fillRect` по всему холсту — иначе углы овала останутся залиты бумагой.

- [ ] **Шаг 2: Скруглить сам элемент холста**

В `resize()` в конец добавить:

```js
  canvas.style.borderRadius = shape === 'oval' ? '50%' : '0';
```

- [ ] **Шаг 3: Обрезать экспорт PNG**

В `exportPNG()` заменить заливку бумагой на обрезанную:

```js
  const g = tmp.getContext('2d');
  g.save();
  clipField(g, w, h);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
```

и добавить `g.restore();` перед `tmp.toBlob(...)`. Для прямоугольника поведение не меняется, для овала за его пределами остаётся прозрачность.

- [ ] **Шаг 4: Обрезать экспорт SVG**

В `exportSVG()` заменить безусловный фон на обрезанный. Добавить в `defs`:

```js
  if (shape === 'oval') {
    defs += `<clipPath id="field"><ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}"/></clipPath>`;
  }
```

Фоновый прямоугольник и всё тело обернуть в группу:

```js
  const clip = shape === 'oval' ? ' clip-path="url(#field)"' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
    + (defs ? `<defs>${defs}</defs>` : '')
    + `<g${clip}><rect width="${w}" height="${h}" fill="${PAPER}"/>` + body + '</g></svg>';
```

Порядок важен: `defs` теперь идёт до тела, потому что `clipPath` должен быть объявлен раньше использования.

- [ ] **Шаг 5: Проверить, что рост не выходит за эллипс**

Запустить сервер, открыть страницу, выполнить:

```js
localStorage.clear(); location.reload();
```

затем нарисовать стену и вырастить узор программно:

```js
const c = document.getElementById('canvas'), r = c.getBoundingClientRect();
const P = (t,x,y) => c.dispatchEvent(new PointerEvent(t,{pointerId:1,bubbles:true,clientX:r.left+x,clientY:r.top+y,button:0,isPrimary:true}));
P('pointerdown', r.width*0.3, r.height*0.5); P('pointermove', r.width*0.7, r.height*0.5); P('pointerup', r.width*0.7, r.height*0.5);
await new Promise(res=>setTimeout(res,300));
```

Переключить форму на овал через панель настроек, перейти в «рост», подождать 8 секунд, затем проверить углы холста:

```js
const g = document.getElementById('canvas').getContext('2d');
const d = document.getElementById('canvas').width;
const corner = g.getImageData(4, 4, 8, 8).data;
let painted = 0;
for (let i = 3; i < corner.length; i += 4) if (corner[i] > 0) painted++;
({ paintedPixelsInCorner: painted })
```

Ожидается: `paintedPixelsInCorner` равен `0`. Любое ненулевое значение значит, что угол за пределами эллипса закрашен, то есть обрезка не работает.

- [ ] **Шаг 6: Проверить прозрачность в PNG**

```js
let blob=null; const orig=URL.createObjectURL; URL.createObjectURL=b=>{blob=b;return 'stub'};
const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){};
document.getElementById('export-png').click();
await new Promise(r=>setTimeout(r,1500));
URL.createObjectURL=orig; HTMLAnchorElement.prototype.click=oc;
const bmp = await createImageBitmap(blob);
const cv = new OffscreenCanvas(bmp.width, bmp.height), cg = cv.getContext('2d');
cg.drawImage(bmp,0,0);
({ cornerAlpha: cg.getImageData(2,2,1,1).data[3], centerAlpha: cg.getImageData(bmp.width>>1, bmp.height>>1,1,1).data[3] })
```

Ожидается: `cornerAlpha` равен `0`, `centerAlpha` равен `255`. Угол прозрачный, середина — бумага.

- [ ] **Шаг 7: Коммит**

```bash
git add app.js
git commit -m "Овал: граница роста, обрезка холста и экспорта, прозрачные углы в PNG

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 3: конец роста, удаление «вернуть», ⌘Z в росте

**Файлы:**
- Изменить: `app.js` (`sprout`, `growStep`, `restartGrowth`, `restoreGrowth`, `key`, `updateControls`, `togglePause`)
- Изменить: `index.html` (удалить кнопку `#restore`)

**Интерфейсы:**
- Отдаёт дальше: `growthState()` возвращает одну из строк `'walls' | 'running' | 'paused' | 'done'` — задача 4 показывает её в рейке
- `sprout(x, y, anyWall)` теперь возвращает `boolean`

- [ ] **Шаг 1: Заставить `sprout` сообщать об успехе**

В `sprout()` заменить три места выхода:
- `if (!closest) return;` → `if (!closest) return false;`
- после `growth.tips.push(...)` → `return true;`
- в самом конце функции, после цикла `for (let n = 0; ...)` → `return false;`

- [ ] **Шаг 2: Добавить состояние `done` и счётчик неудач**

В `startGrowth()` добавить в объект: `done: false, idle: 0, misses: 0,`.

В `growStep()`, сразу после `const m = growth;`, добавить:

```js
  if (m.done) return;
```

В том же `growStep()` заменить блок автозасева и подсева так, чтобы неудачи считались:

```js
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
```

и сделать `feed()` возвращающей успех:

```js
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
```

- [ ] **Шаг 3: Объявлять конец**

В конце `growStep()`, перед проверкой `MAX_SEGMENTS`, добавить:

```js
  /* Сажать больше некуда и живых кончиков нет — рост закончился. */
  if (m.tips.length === 0 && (m.misses >= 3 || !on('auto'))) m.idle += STEP;
  else m.idle = 0;
  if (m.idle > 1.5 && m.segments.length) {
    m.done = true;
    paused = true;
    updateControls();
  }
```

- [ ] **Шаг 4: Снимать `done` при вмешательстве**

Добавить функцию рядом с `togglePause`:

```js
function wake() {
  if (!growth?.done) return;
  growth.done = false;
  growth.idle = 0;
  growth.misses = 0;
  paused = false;
  updateControls();
}
```

Вызывать `wake()` в трёх местах: в `down()` в ветке роста перед `feed(...)`; в `restartGrowth()` в начале; в обработчиках изменения параметров — сейчас это `makeRange`, `makeToggle` и `makePick`, по одной строке сразу после присваивания `values[key]`.

В задаче 5 эти три помощника удаляются, и их место занимает единственный `actions.setValue`, который тоже зовёт `wake()`. Дублирования не возникнет.

- [ ] **Шаг 5: Настроить вход в режим роста по спеке**

В `DEFAULTS` поменять `sow: 1` на `sow: 0` — засев по умолчанию «у стен», иначе узор равномерно заполняет лист и форма исходного рисунка пропадает.

В `setMode()` удалить строку `values.showWalls = true;` и заменить блок входа в рост на:

```js
  if (newMode === 'grow' && !growth) {
    values.showWalls = false;
    values.auto = true;
    startGrowth();
  }
```

Стены скрываются, «растить само» включается: рост должен пойти сам и показать обросший рисунок, а не разметку.

- [ ] **Шаг 6: Добавить `growthState()` и показать состояние**

```js
function growthState() {
  if (mode === 'walls') return 'walls';
  if (growth?.done) return 'done';
  return paused ? 'paused' : 'running';
}
```

В `updateControls()` заменить установку текста `#note` на:

```js
  const note = document.getElementById('note');
  note.textContent = { walls: 'рисование', running: 'растёт', paused: 'на паузе', done: 'готово' }[growthState()];
```

- [ ] **Шаг 7: Удалить «вернуть», перевесить отмену рестарта на ⌘Z**

Удалить из `index.html` кнопку `<button id="restore" ...>`. Удалить из `app.js` функцию `restoreGrowth`, обработчик `document.getElementById('restore')...`, строку `document.getElementById('restore').hidden = ...` в `updateControls`.

Оставить `previousGrowth` и в `key()` расширить ветку отмены:

```js
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
```

- [ ] **Шаг 8: Проверить, что рост заканчивается**

Открыть страницу, очистить хранилище, нарисовать короткую стену (скрипт из задачи 2, шаг 5), перейти в «рост», выставить засев «у стен» и подождать:

```js
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  await new Promise(r => setTimeout(r, 1000));
  if (document.getElementById('note').textContent === 'готово') break;
}
({ state: document.getElementById('note').textContent, seconds: Math.round((Date.now()-t0)/1000) })
```

Ожидается: `state` равен `"готово"` меньше чем за 120 секунд. Если по истечении двух минут состояние всё ещё `"растёт"` — детектор не срабатывает.

Затем проверить, что касание будит рост:

```js
const c = document.getElementById('canvas'), r = c.getBoundingClientRect();
c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,isPrimary:true}));
await new Promise(res=>setTimeout(res,400));
document.getElementById('note').textContent
```

Ожидается: `"растёт"`.

- [ ] **Шаг 9: Коммит**

```bash
git add app.js index.html
git commit -m "Рост получает конец, засев у стен по умолчанию: детектор насыщения, состояние «готово», отмена рестарта на ⌘Z

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 4: разметка, спрайт иконок, рейка

Самая крупная задача: шапка и док удаляются, появляется рейка. Приложение в конце задачи снова рабочее.

**Файлы:**
- Изменить: `index.html` (разметка целиком, спрайт иконок, стили рейки)
- Создать: `ui.js`
- Изменить: `app.js` (`updateControls` заменяется вызовом сборки рейки, обработчики перевешиваются)

**Интерфейсы:**
- Берёт из задачи 1: `shape`, `proportion`, `ratioLabel`
- Берёт из задачи 3: `growthState()`
- `ui.js` отдаёт: `buildRail(root, state, actions)`, где `state` — объект `{mode, tool, railWide, panelOpen, playing, auto, seeWalls, speed, canUndo, placingSVG}`, а `actions` — объект с методами `setMode(m)`, `setTool(t)`, `undo()`, `importSVG()`, `clearWalls()`, `applySVG()`, `cancelSVG()`, `togglePause()`, `restart()`, `setSpeed(v)`, `toggleAuto()`, `toggleWalls()`, `togglePanel()`, `save()`, `toggleRail()`
- Ни одна функция `ui.js` не импортирует `app.js`

- [ ] **Шаг 1: Вложить спрайт иконок**

Добавить сразу после `<body>` в `index.html`. Пути взяты из Lucide (MIT), `viewBox="0 0 24 24"`, обводка задаётся снаружи:

```html
<svg hidden aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>
<symbol id="i-walls" viewBox="0 0 24 24"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2 2 0 0 1 3 3L10 17l-4 1 1-4Z"/></symbol>
<symbol id="i-grow" viewBox="0 0 24 24"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2Z"/></symbol>
<symbol id="i-brush" viewBox="0 0 24 24"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></symbol>
<symbol id="i-eraser" viewBox="0 0 24 24"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></symbol>
<symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></symbol>
<symbol id="i-svg" viewBox="0 0 24 24"><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/><circle cx="9" cy="9" r="2"/></symbol>
<symbol id="i-clear" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M6 3l14 9-14 9Z"/></symbol>
<symbol id="i-restart" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></symbol>
<symbol id="i-auto" viewBox="0 0 24 24"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M3 8h4"/><path d="M17 16h4"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a15 15 0 0 1-2.2 3.1"/><path d="M6.6 6.6A15.5 15.5 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="m9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></symbol>
<symbol id="i-settings" viewBox="0 0 24 24"><path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></symbol>
<symbol id="i-save" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></symbol>
<symbol id="i-fold" viewBox="0 0 24 24"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></symbol>
<symbol id="i-unfold" viewBox="0 0 24 24"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
</defs></svg>
```

- [ ] **Шаг 2: Заменить разметку страницы**

Заменить содержимое `<body>` после спрайта на:

```html
<main>
  <nav class="rail" id="rail" aria-label="Инструменты"></nav>
  <div class="col" id="col"><div class="col-in settings" id="colIn"></div></div>
  <div class="stage" id="stage">
    <div class="sheet" id="sheet">
      <canvas id="canvas" aria-label="Холст для рисования стен и выращивания узора"></canvas>
      <span id="hint">нарисуйте стены — вокруг них пойдёт рост</span>
    </div>
    <div id="message" role="alert" hidden></div>
  </div>
</main>
<span id="note" class="sr-only" role="status"></span>
<input type="file" id="svg-file" hidden accept=".svg,image/svg+xml">
<script type="module" src="app.js"></script>
```

Удалить `<header>`, `.toolbar`, `.dock`, `.export-menu`, `.sketch-panel` и все их стили.

- [ ] **Шаг 3: Стили рейки**

Добавить в `<style>`:

```css
main { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.rail {
  flex: none; width: 50px; display: flex; flex-direction: column; gap: 2px; padding: 8px;
  overflow: hidden; background: var(--bg); border-right: 1px solid var(--border);
  transition: width var(--t) var(--ease);
}
.rail.wide { width: 176px; }
.rail .spacer { flex: 1; min-height: 8px; }
.rail hr { border: 0; border-top: 1px solid var(--border); margin: 6px 2px; flex: none; }
.cap { position: relative; height: 22px; flex: none; display: flex; align-items: center; padding-left: 8px; }
.cap b {
  font: inherit; font-size: 9px; font-weight: 400; letter-spacing: .1em; text-transform: uppercase;
  color: #6f6d67; white-space: nowrap; opacity: 0; transition: opacity .12s ease;
}
.cap i { position: absolute; left: 8px; width: 18px; height: 1px; background: var(--border); transition: opacity .12s ease; }
.rail.wide .cap b { opacity: 1; transition-delay: .07s; }
.rail.wide .cap i { opacity: 0; }
button.t {
  display: flex; align-items: center; gap: 10px; height: 34px; flex: none; padding: 0 8px;
  border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--fg);
  cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; overflow: hidden;
  transition: background .12s ease, color .12s ease;
}
button.t:hover:not(:disabled) { background: #2c2c29; }
button.t:disabled { opacity: .35; cursor: default; }
button.t.on { background: var(--fg); color: var(--bg); }
button.t.ghost { color: var(--muted); }
button.t .ic { width: 18px; height: 18px; flex: none; stroke: currentColor; stroke-width: 1.5; fill: none;
  stroke-linecap: round; stroke-linejoin: round; }
button.t .lbl, button.t .k { opacity: 0; transition: opacity .12s ease; }
button.t .k { margin-left: auto; font-size: 10px; color: #6f6d67; }
button.t.on .k { color: #5a5a55; }
.rail.wide button.t .lbl, .rail.wide button.t .k { opacity: 1; transition-delay: .07s; }
.tempo { display: flex; align-items: center; gap: 10px; height: 34px; flex: none; padding: 0 8px;
  overflow: hidden; color: var(--muted); font-size: 11px; }
.tempo .num { width: 18px; text-align: center; flex: none; }
.tempo input { flex: 1; min-width: 0; accent-color: var(--fg); height: 14px; opacity: 0; transition: opacity .12s ease; }
.rail.wide .tempo input { opacity: 1; transition-delay: .07s; }
.rail:not(.wide) .tempo { cursor: pointer; }
```

Ключевое: кнопки всегда прижаты влево, отступ рейки 8 плюс отступ кнопки 8 дают иконку по центру полосы 50. Центрировать иконки в компактном виде нельзя — они сдвинутся.

- [ ] **Шаг 4: Создать `ui.js` со сборкой рейки**

```js
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
```

- [ ] **Шаг 5: Подключить рейку в `app.js`**

Добавить импорт `import { buildRail } from './ui.js';` и заменить `updateControls()` на:

```js
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

const actions = {
  setMode, setTool: t => { brushErase = t === 'eraser'; updateControls(); },
  undo: undoWalls, importSVG: () => document.getElementById('svg-file').click(),
  clearWalls, applySVG, cancelSVG, togglePause, restart: restartGrowth,
  setSpeed: v => { values.speed = v; updateControls(); saveSoon(); },
  toggleAuto: () => { values.auto = !values.auto; wake(); updateControls(); saveSoon(); },
  toggleWalls: () => { values.showWalls = !values.showWalls; updateControls(); saveSoon(); },
  togglePanel: () => { panelOpen = !panelOpen; updateControls(); fitCanvas(); saveSoon(); },
  save: () => openSavePopover(),
  toggleRail: () => { railWide = !railWide; updateControls(); fitCanvas(); saveSoon(); },
};

function updateControls() {
  buildRail(document.getElementById('rail'), uiState(), actions);
  const note = document.getElementById('note');
  note.textContent = { walls: 'рисование', running: 'растёт', paused: 'на паузе', done: 'готово' }[growthState()];
}
```

Временно определить заглушку `function openSavePopover() { exportPNG(); }` — полноценный поповер делается в задаче 6.

Удалить обработчики удалённых кнопок: `#brush`, `#eraser`, `#brush-size`, `#undo`, `#import`, `#pause`, `#restart`, `#svg-apply`, `#svg-cancel`, `#svg-scale`, `#export-png`, `#export-svg`, `#toggle`, а также функцию `setPanelOpen`.

**`setBrush(size)` не удалять** — её зовёт `wheel()` и инициализация. Переписать её так, чтобы она не лезла в удалённый `#brush-size`:

```js
function setBrush(size) {
  values.brush = clamp(Math.round(size), 2, 26);
  updateControls();
  saveSoon();
}
```

Аналогично `syncSVGScale()` больше не может писать в `#svg-scale`: заменить её тело на `updateControls();`, а сам ползунок масштаба SVG добавить в колонку настроек в задаче 5 в ветке `placingSVG`.

- [ ] **Шаг 6: Проверить неподвижность иконок**

Открыть страницу, выполнить:

```js
const probe = () => [...document.querySelectorAll('#rail button.t .ic')]
  .map(i => { const b = i.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)]; });
const before = probe();
document.querySelector('#rail button.t:last-of-type').click();
await new Promise(r => setTimeout(r, 600));
const after = probe();
({ same: JSON.stringify(before) === JSON.stringify(after),
   railWidth: document.getElementById('rail').getBoundingClientRect().width })
```

Ожидается: `same` равен `true`, `railWidth` равен `50`. Если `same` равен `false` — иконки поехали, нарушено правило из спеки.

- [ ] **Шаг 7: Коммит**

```bash
git add index.html ui.js app.js
git commit -m "Рейка вместо шапки и дока, иконки инлайновым спрайтом

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 5: колонка настроек, группы параметров, форма холста иконками

**Файлы:**
- Изменить: `ui.js` (добавить `buildSettings`)
- Изменить: `index.html` (стили `.col` и `.settings`)
- Изменить: `app.js` (удалить `buildPanel`, `makeRange`, `makeToggle`, `makePick`, `makeSection`, `makeButton`, `makeNote`, `endSection`, `hr`, `setPanelOpen`, `applyPreset`, `changeFormat`)

**Интерфейсы:**
- Берёт из задачи 4: `icon(name)`
- Отдаёт: `buildSettings(root, mode, values, a, svg)`, где `a` дополнен методами `setValue(key, v)`, `setShape(s)`, `setProportion(p)`, `applyPreset(name)`, `resetGrowth()`, `setSVGScale(pct)`, а `svg` — текущий `svgOverlay` или `null`

- [ ] **Шаг 1: Стили колонки и настроек**

```css
.col { flex: none; width: 0; overflow: hidden; background: var(--panel);
  border-right: 1px solid transparent; transition: width var(--t) var(--ease), border-color var(--t); }
.col.open { width: 264px; border-right-color: var(--border); }
.col-in { width: 264px; padding: 12px 14px; opacity: 0; transform: translateX(-10px);
  transition: opacity .16s ease .04s, transform .16s var(--ease) .04s; }
.col.open .col-in { opacity: 1; transform: none; }

/* Класс общий для колонки и мобильного листа. Привязывать к .col нельзя:
   на телефоне заголовки возьмут браузерный дефолт и станут вдвое крупнее. */
.settings h3 { font-size: 9px; letter-spacing: .11em; text-transform: uppercase; color: #6f6d67;
  font-weight: 400; margin: 14px 0 8px; }
.settings h3:first-child { margin-top: 0; }
.settings .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
.settings .field span { font-size: 11px; color: var(--muted); }
.settings input[type=range] { width: 100%; accent-color: var(--fg); height: 16px; }
.settings .seg { display: flex; gap: 4px; margin-bottom: 10px; }
.settings .seg button { flex: 1; height: 30px; border: 1px solid var(--border); border-radius: 5px;
  background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-size: 11px;
  transition: background .12s, color .12s, border-color .12s; }
.settings .seg button.on { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.settings .fmt { display: flex; gap: 5px; margin-bottom: 10px; }
.settings .fmt button { width: 38px; height: 32px; border: 1px solid var(--border); border-radius: 5px;
  background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: border-color .12s, background .12s; }
.settings .fmt button.on { border-color: var(--fg); background: #ffffff14; }
.settings .fmt i { display: block; width: 17px; height: 17px; border: 1.5px solid var(--fg); }
.settings .fmt i.rect { border-radius: 1px; }
.settings .fmt i.oval { border-radius: 50%; }
.settings .presets { display: flex; flex-wrap: wrap; gap: 4px; }
.settings .presets button { flex: 1 1 calc(50% - 4px); height: 30px; border: 1px solid var(--border);
  border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-size: 11px; }
.settings .foot { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 10px; }
.settings .wide-btn { width: 100%; justify-content: flex-start; margin-top: 6px; }
.settings .wide-btn .lbl, .settings .wide-btn .k { opacity: 1; }
```

- [ ] **Шаг 2: Добавить `buildSettings` в `ui.js`**

```js
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
    p.querySelector('input').addEventListener('input', e => a.setProportion(Number(e.target.value)));
    root.append(p);
    return;
  }

  root.insertAdjacentHTML('beforeend', '<h3>заселение</h3>'
    + `<div class="seg">${['у стен', 'у нароста', 'везде']
        .map((t, i) => `<button data-sow="${i}" class="${values.sow === i ? 'on' : ''}">${t}</button>`).join('')}</div>`);
  root.querySelectorAll('[data-sow]').forEach(b =>
    b.addEventListener('click', () => a.setValue('sow', Number(b.dataset.sow))));

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
```

Заметьте: группа «заселение» выводится первой отдельно, потому что её первый элемент — сегментированный переключатель, а не ползунок. Поэтому в `GROUPS` для неё заголовок не печатается повторно.

- [ ] **Шаг 3: Подключить колонку в `app.js`**

Удалить `buildPanel` и все `make*` помощники. Добавить в `updateControls()` после `buildRail`:

```js
  document.getElementById('col').className = 'col' + (panelOpen ? ' open' : '');
  buildSettings(document.getElementById('colIn'), mode, values, actions, svgOverlay);
```

Добавить в `actions`:

```js
  setValue: (key, v) => {
    values[key] = v;
    if (key === 'gap') rebuildGrowthMask();
    wake(); saveSoon();
  },
  setShape: s => { applyField(s, proportion); resize(); rebuildWallCanvas(); updateControls(); saveSoon(); },
  setProportion: p => { applyField(shape, p); resize(); rebuildWallCanvas(); updateControls(); saveSoon(); },
  applyPreset: name => { Object.assign(values, PRESETS[name]); rebuildGrowthMask(); wake(); updateControls(); saveSoon(); },
  resetGrowth: () => { for (const k of GROWTH_KEYS) values[k] = DEFAULTS[k]; rebuildGrowthMask(); wake(); updateControls(); saveSoon(); },
  setSVGScale: pct => {
    const o = svgOverlay;
    if (!o) return;
    scaleSVG(o.baseH * pct / 100, o.x + overlayWidth(o) / 2, o.y + o.h / 2);
  },
```

Убрать `speed` из `GROWTH_KEYS` — темп теперь живёт в рейке и пресетами не сбрасывается вместе с характером узора. Оставить его в самих пресетах.

- [ ] **Шаг 4: Проверить размер заголовков и состав групп**

```js
const h = [...document.querySelectorAll('#colIn h3')].map(x => x.textContent);
({ headings: h, size: getComputedStyle(document.querySelector('#colIn h3')).fontSize,
   sliders: document.querySelectorAll('#colIn input[type=range]').length })
```

В режиме «рост» ожидается: `headings` равен `["заселение","движение","линия","пресет"]`, `size` равен `"9px"`, `sliders` равен `10`.

Десять — это три в заселении, четыре в движении, три в линии. Если одиннадцать, значит скорость осталась в колонке, а она должна быть в рейке.

- [ ] **Шаг 5: Коммит**

```bash
git add ui.js index.html app.js
git commit -m "Колонка настроек: три группы вместо основных и дополнительных, форма холста иконками

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 6: холст в свободной части, поповер сохранения, хранилище интерфейса

**Файлы:**
- Изменить: `app.js` (`resize`, `fitCanvas`, `save`, `load`, `openSavePopover`)
- Изменить: `index.html` (стили `.stage`, `.sheet`, `#canvas`, `.popover`)

**Интерфейсы:**
- Отдаёт: `fitCanvas(occupied = 0)` — `occupied` в пикселях, сколько высоты сцены занято мобильным листом; на широком экране всегда 0

- [ ] **Шаг 1: Стили сцены и листа**

```css
.stage { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex;
  align-items: center; justify-content: center; background: var(--stage); }
.sheet { position: relative; flex: none; display: flex; }
#canvas { display: block; cursor: crosshair; touch-action: none; background: var(--bg);
  border: 1px solid var(--edge); box-shadow: 0 14px 44px #000a;
  transform-origin: center; transition: transform var(--t) var(--ease); }
.popover { position: absolute; z-index: 9; display: flex; gap: 4px; padding: 5px;
  border: 1px solid var(--border); border-radius: 8px; background: #1c1c1bf5;
  backdrop-filter: blur(8px); box-shadow: 0 10px 28px #000a; }
.popover button { min-height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 5px;
  background: transparent; color: var(--fg); font: inherit; font-size: 12px; cursor: pointer; }
.popover button:hover { background: #2c2c29; }
```

`.sheet` больше не центрирует ничего сама — центрирование делает `.stage`, а `flex: none` на холсте обязателен, иначе флекс сожмёт его по одной оси и пропорция поедет.

- [ ] **Шаг 2: Переписать расчёт размера**

```js
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

/* Холст центрируется в СВОБОДНОЙ части сцены, а не в сцене целиком.
   На широком экране колонка стоит в потоке, поэтому свободная часть получается сама.
   На телефоне лист лежит поверх — его высоту передают в occupied. */
function fitCanvas(occupied = 0) {
  const stage = document.getElementById('stage');
  const freeH = Math.max(80, stage.clientHeight - occupied);
  const k = Math.min(1, (stage.clientWidth - GUTTER * 2) / Sx, (freeH - GUTTER * 2) / Sy);
  const ty = -(stage.clientHeight - freeH) / 2;
  canvas.style.transform = `translateY(${ty.toFixed(1)}px) scale(${k.toFixed(4)})`;
}
```

Заменить `new ResizeObserver(resize).observe(sheet)` на `new ResizeObserver(() => fitCanvas()).observe(document.getElementById('stage'))` плюс `addEventListener('resize', resize)`. Наблюдать за сценой ради `resize` нельзя: колонка меняет её ширину, и растр пересчитывался бы при каждом открытии панели.

- [ ] **Шаг 3: Поповер сохранения**

```js
let popover = null;

function closePopover() {
  popover?.remove();
  popover = null;
}

function openSavePopover() {
  if (popover) { closePopover(); return; }
  const anchor = [...document.querySelectorAll('#rail button.t')].find(b => b.title.startsWith('сохранить'));
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
  if (popover && !popover.contains(e.target) && !e.target.closest('#rail button.t')) closePopover();
});
```

В `key()` переписать обработку Escape целиком — `setPanelOpen` к этому моменту удалён, и без этого шага Esc перестанет закрывать настройки:

```js
  if (event.key === 'Escape') {
    if (popover) { closePopover(); return; }
    if (svgOverlay) { cancelSVG(); return; }
    if (panelOpen) { panelOpen = false; updateControls(); fitCanvas(); saveSoon(); return; }
    return;
  }
```

Порядок важен: сначала закрывается самое верхнее — поповер, потом размещение SVG, потом панель.

- [ ] **Шаг 4: Хранить состояние интерфейса**

В `save()` добавить в сохраняемый объект `ui: { railWide, panelOpen }`. В `load()` после чтения:

```js
  if (saved.ui) {
    railWide = saved.ui.railWide !== false;
    panelOpen = saved.ui.panelOpen !== false;
  }
```

Значения по умолчанию `railWide = true` и `panelOpen = true` уже стоят при объявлении — при первом запуске колонка открыта, как требует спека.

- [ ] **Шаг 5: Проверить, что растр не пересчитывается от панели**

```js
const c = document.getElementById('canvas');
const before = [c.width, c.height];
[...document.querySelectorAll('#rail button.t')].find(b => b.title.startsWith('настройки')).click();
await new Promise(r => setTimeout(r, 500));
const after = [c.width, c.height];
({ rasterUnchanged: before[0] === after[0] && before[1] === after[1],
   transform: c.style.transform,
   overlap: Math.round(c.getBoundingClientRect().left) >= Math.round(document.getElementById('stage').getBoundingClientRect().left) })
```

Ожидается: `rasterUnchanged` равен `true`, `transform` содержит `scale(`, `overlap` равен `true`. Первое значит, что узор не перерисовывался; третье — что холст не заехал под колонку.

- [ ] **Шаг 6: Коммит**

```bash
git add app.js index.html
git commit -m "Холст в свободной части сцены, поповер форматов, состояние интерфейса в хранилище

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 7: мобильная раскладка

**Файлы:**
- Изменить: `index.html` (медиазапрос `≤ 720px`, разметка полосы и листа)
- Изменить: `ui.js` (`buildBar`)
- Изменить: `app.js` (переключение между рейкой и полосой, долгий тап, `fitCanvas` с высотой листа)

**Интерфейсы:**
- Берёт из задачи 6: `fitCanvas(occupied)`
- `ui.js` отдаёт: `buildBar(root, state, actions)` — те же `state` и `actions`, что у `buildRail`

- [ ] **Шаг 1: Разметка полосы и листа**

В `index.html` внутрь `<main>` после `.stage` добавить:

```html
<div class="bar" id="bar" aria-label="Инструменты" hidden></div>
<div class="msheet settings" id="msheet" hidden></div>
<div class="brushpop" id="brushpop" hidden>
  <span>размер</span><input type="range" min="2" max="26" value="6" aria-label="Размер кисти"><span id="bpval">6</span>
</div>
```

- [ ] **Шаг 2: Стили узкого экрана**

```css
@media (max-width: 720px) {
  main { flex-direction: column; }
  .rail, .col { display: none; }
  .bar { display: flex !important; flex: none; align-items: center; gap: 5px; padding: 0 8px;
    height: calc(58px + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom);
    background: var(--bg); border-top: 1px solid var(--border); z-index: 3; }
  .bar .modeseg { display: flex; flex: none; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
  .bar .modeseg button { width: 44px; height: 42px; border: 0; background: transparent; color: var(--muted);
    cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .12s, color .12s; }
  .bar .modeseg button.on { background: var(--fg); color: var(--bg); }
  .bar .tools { display: flex; gap: 4px; flex: 1; justify-content: center; }
  .bar button.t { width: 44px; height: 44px; padding: 0; justify-content: center; }
  .bar button.t .lbl, .bar button.t .k { display: none; }
  .msheet { display: block !important; position: absolute; left: 0; right: 0;
    bottom: calc(58px + env(safe-area-inset-bottom)); z-index: 2; max-height: 52%; overflow-y: auto;
    background: var(--panel); border-top: 1px solid var(--border); padding: 12px 14px;
    transform: translateY(101%); transition: transform .22s var(--ease); }
  .msheet.open { transform: none; }
  .msheet .quick { display: flex; gap: 5px; margin-bottom: 12px; }
  .msheet .quick button { flex: 1; height: 40px; border: 1px solid var(--border); border-radius: 6px;
    background: transparent; color: var(--muted); cursor: pointer; display: flex; align-items: center;
    justify-content: center; gap: 7px; font: inherit; font-size: 11px; }
  .brushpop { display: flex !important; position: absolute; left: 8px; right: 8px;
    bottom: calc(64px + env(safe-area-inset-bottom)); z-index: 4; align-items: center; gap: 10px;
    padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; background: #1c1c1bf5;
    backdrop-filter: blur(8px); color: var(--muted); font-size: 11px;
    opacity: 0; transform: translateY(6px); pointer-events: none;
    transition: opacity .14s ease, transform .14s var(--ease); }
  .brushpop.open { opacity: 1; transform: none; pointer-events: auto; }
  .brushpop input { flex: 1; accent-color: var(--fg); }
}
@media (min-width: 721px) { .bar, .msheet, .brushpop { display: none !important; } }
```

- [ ] **Шаг 3: `buildBar` в `ui.js`**

```js
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
  if (s.mode === 'walls') {
    add('brush', 'кисть', { on: s.tool === 'brush', click: () => a.setTool('brush') });
    add('eraser', 'ластик', { on: s.tool === 'eraser', click: () => a.setTool('eraser') });
    add('undo', 'отменить', { ghost: true, disabled: !s.canUndo, click: a.undo });
  } else {
    const done = s.growthState === 'done';
    add(s.playing && !done ? 'pause' : 'play', done ? 'готово' : 'пауза', { disabled: done, click: a.togglePause });
    add('restart', 'заново', { ghost: true, click: a.restart });
    add('auto', 'растить само', { on: s.auto, click: a.toggleAuto });
  }
  root.append(tools);
  root.append(barButton('settings', 'настройки', { on: s.panelOpen, click: a.togglePanel }));
  root.append(barButton('save', 'сохранить', { ghost: true, click: a.save }));
}

function barButton(name, label, o = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 't' + (o.on ? ' on' : '') + (o.ghost ? ' ghost' : '');
  b.title = label;
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
    row.innerHTML = `<button data-q="svg">${icon('svg')}вставить SVG</button>`
      + `<button data-q="clear">${icon('clear')}очистить</button>`;
  } else {
    row.innerHTML = `<button data-q="eye">${icon(s.seeWalls ? 'eye' : 'eye-off')}стены</button>`
      + `<button data-q="tempo">${icon('auto')}темп · ${s.speed}×</button>`;
  }
  row.addEventListener('click', e => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q === 'svg') a.importSVG();
    if (q === 'clear') a.clearWalls();
    if (q === 'eye') a.toggleWalls();
  });
  root.prepend(row);
}
```

Кнопка «темп» в листе — только индикатор: сам ползунок темпа добавляется следующим шагом в `app.js`, чтобы не дублировать разметку.

- [ ] **Шаг 4: Подключить в `app.js`**

В `updateControls()` добавить:

```js
  const narrow = matchMedia('(max-width: 720px)').matches;
  const s = uiState();
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
```

где `tempoField()` — обычный ползунок темпа для листа:

```js
function tempoField() {
  const l = document.createElement('label');
  l.className = 'field';
  l.innerHTML = `<span>темп · ${num('speed')}</span>`
    + `<input type="range" min="1" max="16" step="1" value="${num('speed')}">`;
  l.querySelector('input').addEventListener('input', e => actions.setSpeed(Number(e.target.value)));
  return l;
}
```

- [ ] **Шаг 5: Долгий тап на кисти и ластике**

```js
let holdTimer = 0;
document.getElementById('bar').addEventListener('pointerdown', e => {
  const b = e.target.closest('button.t');
  if (!b || !/кисть|ластик/.test(b.title)) return;
  holdTimer = setTimeout(() => {
    const pop = document.getElementById('brushpop');
    pop.classList.add('open');
    pop.querySelector('input').value = num('brush');
    document.getElementById('bpval').textContent = num('brush');
  }, 450);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  document.getElementById('bar').addEventListener(ev, () => clearTimeout(holdTimer));
}
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
```

- [ ] **Шаг 6: Проверить, что лист не накрывает рисунок**

Эмулировать узкий экран (ширина 375), открыть страницу, выполнить:

```js
const c = document.getElementById('canvas'), ms = document.getElementById('msheet');
const cells = document.querySelectorAll('#bar > *').length;
const cb = c.getBoundingClientRect(), mb = ms.getBoundingClientRect();
({ cells, sheetOpen: ms.classList.contains('open'),
   noOverlap: Math.round(cb.bottom) <= Math.round(mb.top),
   headingSize: getComputedStyle(ms.querySelector('h3')).fontSize,
   barFits: document.getElementById('bar').scrollWidth <= document.getElementById('bar').clientWidth })
```

Ожидается: `cells` равен `4` (сегмент режима, блок инструментов, настройки, сохранить), `noOverlap` равен `true`, `headingSize` равен `"9px"`, `barFits` равен `true`.

`noOverlap` — главная проверка: нижний край холста должен быть выше верхнего края листа. `barFits` ловит переполнение полосы.

- [ ] **Шаг 7: Коммит**

```bash
git add index.html ui.js app.js
git commit -m "Мобильная раскладка: полоса из шести ячеек, лист над ней, размер кисти долгим тапом

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Задача 8: движение, доступность, чистка

**Файлы:**
- Изменить: `index.html` (`prefers-reduced-motion`, подсказка)
- Изменить: `app.js` (`updateHint`, удаление мёртвого кода)
- Изменить: `README.md`

- [ ] **Шаг 1: Обнулить движение по запросу системы**

```css
@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0s !important; animation-duration: 0s !important; }
}
```

- [ ] **Шаг 2: Подсказка только на пустом холсте**

```js
function updateHint() {
  ensureGrid();
  const show = mode === 'walls' && !svgOverlay && !wallsPresent && !hasInteracted;
  hintEl.hidden = !show;
  hintEl.textContent = 'нарисуйте стены — вокруг них пойдёт рост';
}
```

Стили подсказки:

```css
#hint { position: absolute; left: 50%; bottom: 1.1rem; transform: translateX(-50%);
  max-width: min(90%, 420px); padding: .45rem .8rem; border-radius: 999px;
  background: #1d1d1caa; backdrop-filter: blur(3px); text-align: center; color: var(--muted);
  font-family: 'PT Sans', sans-serif; font-size: .85rem; line-height: 1.4; pointer-events: none; }
```

Подсказка лежит в `.sheet`, поэтому масштабируется вместе с холстом — это правильно, она относится к листу.

- [ ] **Шаг 3: Убрать мёртвый код**

Проверить, что в `app.js` не осталось ссылок на удалённые сущности:

```bash
grep -n "ASPECTS\|buildPanel\|makeSection\|setPanelOpen\|restoreGrowth\|panelTarget\|export-menu\|#toggle\|sketch-panel" app.js index.html
```

Ожидается: пусто. Каждое найденное вхождение удалить.

- [ ] **Шаг 4: Линт на неиспользуемое**

```bash
cd /tmp && cat > eslint.config.mjs <<'EOF'
export default [{ files:['**/*.js'], languageOptions:{ ecmaVersion:2022, sourceType:'module',
  globals:{ document:'readonly', window:'readonly', performance:'readonly', requestAnimationFrame:'readonly',
    devicePixelRatio:'readonly', localStorage:'readonly', setTimeout:'readonly', clearTimeout:'readonly',
    FileReader:'readonly', DOMParser:'readonly', Image:'readonly', Blob:'readonly', URL:'readonly',
    btoa:'readonly', unescape:'readonly', ResizeObserver:'readonly', matchMedia:'readonly',
    PointerEvent:'readonly', addEventListener:'readonly' }},
  rules:{ 'no-unused-vars':'warn', 'no-undef':'error' }}];
EOF
npx --yes eslint@9 --config /tmp/eslint.config.mjs /Users/pustota/projects/grow.pustota.link/*.js
```

Ожидается: ноль ошибок. Предупреждения о неиспользуемых переменных разобрать: либо удалить переменную, либо использовать.

- [ ] **Шаг 5: Обновить README**

Внести ровно эти правки:

- **«Устройство экрана»** — заменить описание шапки, строки под холстом и панели на: рейка слева в двух состояниях (50 px иконками, 172 px с подписями, состояние запоминается); колонка настроек шириной 264 px встаёт в потоке рядом с рейкой и при первом запуске открыта; холст центрируется в свободной части и никогда ничем не накрывается.
- **«Управление»** — убрать строку про «вернуть». Добавить, что ⌘/Ctrl+Z в режиме роста отменяет «заново», а подсказки клавиш написаны на кнопках рейки.
- **«Формат холста»** — заменить список из четырёх форматов на: форма (прямоугольник или овал) и ползунок пропорции `2^t`, t от −1 до 1, с A4 ровно на половине хода. Добавить, что овал — граница роста, а не обрезка постфактум.
- **«Экспорт»** — добавить, что за пределами овала в PNG прозрачность, в SVG — обрезка по `clipPath`.
- **Новый раздел «Рост»** — рост стартует сам с засевом у стен, стены при этом скрыты; когда сеять негде и живых побегов нет, рост встаёт сам и показывает «готово»; любое касание будит его.
- **«Техническое»** — добавить: геометрия поля вынесена в `field.js`, сборка интерфейса — в `ui.js`; зависимости односторонние, `field.js` не импортирует ничего, `ui.js` импортирует только `field.js` и получает действия колбэками, поэтому циклов нет.

- [ ] **Шаг 6: Сквозная проверка**

Пройти руками сценарий целиком и убедиться, что каждый пункт выполняется:

1. Открыть с пустым хранилищем — колонка настроек открыта, подсказка видна, «рост» недоступен.
2. Нарисовать стену — подсказка исчезла, «рост» доступен, «отменить» доступно.
3. Свернуть и развернуть рейку — иконки не шелохнулись, узор не перерисовался.
4. Переключить форму на овал — холст стал эллипсом, стены обрезались по кривой.
5. Перейти в «рост» — стены скрыты, рост пошёл сам, засев у стен.
6. Дождаться «готово» — кнопка паузы недоступна, состояние `готово`.
7. Коснуться холста — рост проснулся.
8. Сохранить PNG и SVG — оба файла открываются, углы овала прозрачны.
9. Перезагрузить — стены, форма, пропорция и состояние рейки на месте.
10. Сузить окно до 375 — появилась полоса, колонка исчезла, лист не накрывает рисунок.

- [ ] **Шаг 7: Коммит**

```bash
git add -A
git commit -m "Движение, подсказка только на пустом холсте, чистка мёртвого кода, README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
