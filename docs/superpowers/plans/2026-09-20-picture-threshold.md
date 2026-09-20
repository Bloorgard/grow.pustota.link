# Порог для картинок — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-НАВЫК: `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans`. Шаги помечены чекбоксами (`- [ ]`).

**Цель.** Дать возможность закинуть на холст фотографию или любую непрозрачную картинку и получить из неё стены, настроив порог и сглаживание.

**Архитектура.** Бинаризация происходит один раз, на входе: картинка превращается в силуэт на прозрачном фоне, и дальше живёт как сегодняшняя вставленная картинка. Ядро (`drawOp`, `ensureGrid`, оба экспорта, ладошка, отмена) не меняется вовсе — оно уже умеет работать с прозрачностью. Вся новая логика — в отдельном модуле `picture.js`, который о приложении ничего не знает.

**Стек.** Нативные ES-модули, Canvas 2D, ванильный JS. Сборки нет, зависимостей нет и добавлять их нельзя.

**Спека.** `docs/superpowers/specs/2026-09-20-picture-threshold-design.md` — читать её при сомнениях о «почему».

## Глобальные ограничения

- Интерфейс русский строчными буквами: `порог`, `сглаживание`, `инвертировать`. Заголовки разделов поднимает в верхний регистр CSS, не разметка.
- Комментарии в коде русские, по делу, без пересказа очевидного. Сообщения коммитов русские.
- Новых зависимостей и шагов сборки нет. Только нативные модули.
- Зависимости односторонние, циклов нет: `field.js` и `picture.js` не импортируют ничего, `ui.js` импортирует только `field.js`, всё сводит `app.js`.
- Проверка — только через `python3 docs/superpowers/plans/serve.py` (отдаёт `Cache-Control: no-store`). С обычным `python3 -m http.server` браузер держит прежний модуль и пробы врут.
- Синтетические события указателя — только с `pointerId: 1`, иначе `setPointerCapture` бросает `NotFoundError`.
- Панель браузера копит записи консоли между навигациями. Прежде чем чинить «ошибку в консоли», повесить слушатель `error`, повторить действие и посчитать.
- Тестового раннера нет и добавлять его не надо. Проверка — `node --check`, линт и пробы в браузере **с конкретным ожидаемым числом**. Проба без критерия «прошло или нет» бесполезна.
- Инвариант: новое состояние, влияющее на вид, обязано попасть в подпись `updateControls`. Значения `values.*` в подпись не входят намеренно — для чисел и подписей существует точечная правка (`patchTempo`, `syncBrushSlider`, `syncSVGScale`).
- Инвариант: новый элемент управления нужен в обеих оболочках — колонка (`buildSettings`) и мобильный лист. Лист собирается той же `buildSettings`, но проверять надо оба.
- Не трогать: `GRID_BASE = 420`, `EDGE = 0.035`, `EXPORT_LONG_SIDE = 2048`.

## Структура файлов

| Файл | Что с ним происходит |
|------|----------------------|
| `picture.js` | **Создаётся.** Чистые функции над пикселями: анализ картинки, порог по Оцу, размытие, бинаризация. Ничего не импортирует. |
| `app.js` | Правится в четырёх местах: `loadPicture` (анализ и предпросмотр), `drawSVGOverlay` (показывать бинаризованное), `applySVG` (запекание), `actions` (три новых действия) плюс подпись `updateControls`. |
| `ui.js` | Правится в одном месте: ветка `if (svg)` в `buildSettings` — два ползунка и кнопка, только в режиме `luma`. |
| `README.md`, `AGENTS.md` | Обновляются в последней задаче. |

---

### Задача 1: модуль `picture.js`

**Файлы:**
- Создать: `picture.js`

**Интерфейсы:**
- Потребляет: ничего.
- Отдаёт: `analyze(img) -> { mode, threshold, invert }`, где `mode` это строка `'alpha'` или `'luma'`, `threshold` — число 0…100, `invert` — булево. `binarize(img, { threshold, blur, invert, maxSide }) -> HTMLCanvasElement`. `toPNG(canvas) -> string` (data-URL).

- [ ] **Шаг 1: создать файл целиком**

```js
/* Бинаризация картинки: на входе Image, на выходе холст с силуэтом на
   прозрачном фоне. Модуль не знает о приложении и ничего не импортирует.

   Смысл: после бинаризации фотография становится обычной вставленной
   картинкой, и ядро (показ, сетка столкновений, экспорт) не меняется. */

const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/* Уменьшенная копия: анализ и предпросмотр не должны зависеть от того,
   принесли фотографию 400 пикселей или 6000. */
function drawScaled(img, maxSide) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const k = Math.min(1, maxSide / Math.max(iw, ih));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(iw * k));
  canvas.height = Math.max(1, Math.round(ih * k));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, g };
}

/* Метод Оцу: ищет порог, при котором разброс яркостей внутри двух групп
   наименьший. На чёрном тексте по белому попадает точно между ними. */
function otsu(hist, total) {
  if (!total) return 128;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) sum += v * hist[v];
  let sumB = 0, countB = 0, best = 128, bestVariance = -1;
  for (let v = 0; v < 256; v += 1) {
    countB += hist[v];
    if (!countB) continue;
    const countF = total - countB;
    if (!countF) break;
    sumB += v * hist[v];
    const meanB = sumB / countB;
    const meanF = (sum - sumB) / countF;
    const between = countB * countF * (meanB - meanF) ** 2;
    if (between > bestVariance) { bestVariance = between; best = v; }
  }
  return best;
}

/* Разделимое коробчатое размытие: два прохода по строкам и столбцам.
   Радиус в пикселях уменьшенной копии. */
function boxBlur(src, w, h, radius) {
  if (radius < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Uint8ClampedArray(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = sum / span;
      sum -= src[row + Math.min(w - 1, Math.max(0, x - radius))];
      sum += src[row + Math.min(w - 1, Math.max(0, x + radius + 1))];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = sum / span;
      sum -= tmp[Math.min(h - 1, Math.max(0, y - radius)) * w + x];
      sum += tmp[Math.min(h - 1, Math.max(0, y + radius + 1)) * w + x];
    }
  }
  return out;
}

/* Доля прозрачных пикселей больше этой — картинка уже силуэт, порог не нужен.
   Пять процентов: полупрозрачная кайма по краю вырезанного объекта занимает
   единицы процентов и не должна уводить картинку в режим яркости. */
const CLEAR_SHARE = 0.05;

export function analyze(img) {
  const { canvas, g } = drawScaled(img, 400);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const total = canvas.width * canvas.height;
  const hist = new Uint32Array(256);
  let clear = 0;
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] < 250) { clear += 1; continue; }
    hist[lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) | 0] += 1;
  }
  if (clear > total * CLEAR_SHARE) return { mode: 'alpha', threshold: 50, invert: false };
  const opaque = total - clear;
  const cut = otsu(hist, opaque);
  let dark = 0;
  for (let v = 0; v < cut; v += 1) dark += hist[v];
  /* Стеной становится меньшинство: тёмный объект на светлом фоне или
     светлый на тёмном. Промах поправляется кнопкой «инвертировать». */
  return { mode: 'luma', threshold: Math.round(cut / 255 * 100), invert: dark > opaque / 2 };
}

export function binarize(img, { threshold, blur = 0, invert = false, maxSide }) {
  const { canvas, g } = drawScaled(img, maxSide);
  const image = g.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const total = canvas.width * canvas.height;
  const luma = new Uint8ClampedArray(total);
  const solid = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    solid[i] = data[i * 4 + 3] >= 250 ? 1 : 0;
    luma[i] = lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  const smooth = boxBlur(luma, canvas.width, canvas.height, Math.round(blur));
  const cut = threshold / 100 * 255;
  for (let i = 0; i < total; i += 1) {
    /* Прозрачное не становится стеной никогда, в том числе при инверсии. */
    const wall = solid[i] && (invert ? smooth[i] > cut : smooth[i] < cut);
    data[i * 4] = 0;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = wall ? 255 : 0;
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

export const toPNG = canvas => canvas.toDataURL('image/png');
```

- [ ] **Шаг 2: проверить синтаксис**

Выполнить: `node --check picture.js`
Ожидается: команда молчит, код возврата 0.

- [ ] **Шаг 3: поднять сервер**

Выполнить: `python3 docs/superpowers/plans/serve.py`
Открыть `http://127.0.0.1:8777/`. **Только этот скрипт** — он отдаёт `Cache-Control: no-store`.

- [ ] **Шаг 4: проба Оцу на двух полях**

В консоли страницы:

```js
const { analyze, binarize } = await import('/picture.js');
const make = (paint) => { const c = document.createElement('canvas'); c.width = 200; c.height = 100;
  const g = c.getContext('2d'); paint(g); const i = new Image(); i.src = c.toDataURL(); return new Promise(r => i.onload = () => r(i)); };
const two = await make(g => { g.fillStyle = 'rgb(30,30,30)'; g.fillRect(0,0,80,100); g.fillStyle = 'rgb(220,220,220)'; g.fillRect(80,0,120,100); });
analyze(two);
```

Ожидается: `mode: 'luma'`, `threshold` между 12 и 86 (то есть порог лёг между яркостями 30 и 220), `invert: false` — тёмного поля меньше, оно и есть стена.

- [ ] **Шаг 5: проба режима прозрачности**

```js
const clear = await make(g => { g.fillStyle = '#fff'; g.fillRect(20,20,60,60); });
analyze(clear);
```

Ожидается: `mode: 'alpha'` — прозрачного больше 5%, порог не нужен.

- [ ] **Шаг 6: проба сглаживания**

```js
const noisy = await make(g => { for (let i = 0; i < 4000; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
  g.fillRect((Math.random()*200)|0, (Math.random()*100)|0, 1, 1); } });
const count = b => { const g = b.getContext('2d'); const d = g.getImageData(0,0,b.width,b.height).data;
  let n = 0; for (let i = 0; i < b.width*b.height; i++) if (d[i*4+3] > 0) n++; return n; };
const a0 = binarize(noisy, { threshold: 50, blur: 0, invert: false, maxSide: 200 });
const a6 = binarize(noisy, { threshold: 50, blur: 6, invert: false, maxSide: 200 });
[count(a0), count(a6)];
```

Ожидается: два числа, второе **меньше** первого — размытие съело часть крошки. Если числа равны, `boxBlur` не работает.

- [ ] **Шаг 7: проба инверсии**

```js
const inv = binarize(two, { threshold: 50, blur: 0, invert: true, maxSide: 200 });
const str = binarize(two, { threshold: 50, blur: 0, invert: false, maxSide: 200 });
[count(str), count(inv)];
```

Ожидается: примерно `[8000, 12000]` — прямой вариант отмечает узкое тёмное поле (80×100), инвертированный широкое светлое (120×100). Сумма близка к 20000.

- [ ] **Шаг 8: коммит**

```bash
git add picture.js
git commit -m "Модуль picture.js: анализ картинки, порог по Оцу, размытие, бинаризация"
```

---

### Задача 2: анализ и предпросмотр при загрузке

**Файлы:**
- Изменить: `app.js` — `loadPicture` (около строки 291), `drawSVGOverlay` (около строки 568), импорты вверху файла.

**Интерфейсы:**
- Потребляет: `analyze`, `binarize` из `picture.js`.
- Отдаёт: у объекта `svgOverlay` появляются поля `mode` (`'alpha'` | `'luma'`), `threshold` (0…100), `blur` (0…10), `invert` (булево), `shown` (то, что рисуется на холсте: исходный `Image` в режиме `alpha`, бинаризованный `canvas` в режиме `luma`). Функция `refreshPreview()` пересобирает `shown`.

- [ ] **Шаг 1: добавить импорт**

В начало `app.js`, к существующим импортам:

```js
import { analyze, binarize, toPNG } from './picture.js';
```

`toPNG` понадобится в задаче 4 — импортировать сразу, чтобы не трогать строку дважды.

- [ ] **Шаг 2: добавить размеры и функцию предпросмотра**

Рядом с `overlayWidth` (около строки 287):

```js
/* Предпросмотр считается на уменьшенной копии: на фотографии 4000×3000
   полноразмерный пересчёт на каждое движение ползунка не укладывается в кадр.
   Запекается картинка уже в PREVIEW_BAKE. */
const PREVIEW_SIDE = 700;
const PREVIEW_BAKE = 1600;

function refreshPreview() {
  const o = svgOverlay;
  if (!o) return;
  o.shown = o.mode === 'luma'
    ? binarize(o.img, { threshold: o.threshold, blur: o.blur, invert: o.invert, maxSide: PREVIEW_SIDE })
    : o.img;
}
```

- [ ] **Шаг 3: завести состояние при загрузке**

В `loadPicture`, в `img.onload`, заменить создание `svgOverlay` на:

```js
      const { mode, threshold, invert } = analyze(img);
      svgOverlay = {
        img, src, ia, h, baseH: h,
        x: (1 - w) / 2, y: (1 - h) / 2,
        dragging: false, grabDx: 0, grabDy: 0,
        mode, threshold, blur: 0, invert, shown: img,
      };
      refreshPreview();
```

Остальные строки (`hasInteracted`, `syncSVGScale`, `updateControls`, `updateHint`, `updateGrowButton`) остаются как есть, ниже.

- [ ] **Шаг 4: показывать бинаризованное**

В `drawSVGOverlay` заменить строку

```js
  ctx.drawImage(o.img, px, py, pw, ph);
```

на

```js
  ctx.drawImage(o.shown, px, py, pw, ph);
```

Фильтр `brightness(0) invert(1)` строкой выше не трогать: он делает силуэт по прозрачности белым, и для бинаризованного холста работает так же.

- [ ] **Шаг 5: поправить сообщение об ошибке**

В `loadPicture`, в `fail`, заменить текст на:

```js
    if (version === importVersion) showMessage('Не удалось открыть файл. Подойдут SVG, PNG, JPEG, WEBP и GIF.');
```

Поле `accept` в `index.html` уже перечисляет эти форматы — его не трогать.

- [ ] **Шаг 6: проверить синтаксис**

Выполнить: `node --check app.js`
Ожидается: молчит.

- [ ] **Шаг 7: проба — фотография становится силуэтом**

На странице (сервер из задачи 1, шаг 3) выполнить в консоли: создать непрозрачную картинку с тёмным пятном, скормить её через поле файла.

```js
window.__err = []; addEventListener('error', e => __err.push(e.message));
const c = document.createElement('canvas'); c.width = 400; c.height = 300;
const g = c.getContext('2d'); g.fillStyle = '#ddd'; g.fillRect(0,0,400,300);
g.fillStyle = '#222'; g.beginPath(); g.arc(200,150,90,0,7); g.fill();
const blob = await new Promise(r => c.toBlob(r, 'image/png'));
const file = new File([blob], 'photo.png', { type: 'image/png' });
const dt = new DataTransfer(); dt.items.add(file);
const input = document.getElementById('svg-file');
input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
await new Promise(r => setTimeout(r, 400));
__err;
```

Ожидается: пустой массив ошибок, а на холсте — **белый круг**, а не белый прямоугольник на весь кадр. Прямоугольник означает, что режим определился как `alpha` или предпросмотр не применился.

- [ ] **Шаг 8: замерить долю закрашенного**

```js
const cv = document.getElementById('canvas');
const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
let n = 0; for (let i = 0; i < cv.width*cv.height; i++) if (d[i*4] > 140) n++;
(n / (cv.width*cv.height)).toFixed(3);
```

Ожидается: примерно `0.05`…`0.12` — круг занимает часть холста. Значение выше `0.3` означает, что закрашен весь прямоугольник картинки, то есть бинаризация не сработала.

- [ ] **Шаг 9: проба — прежнее поведение не сломано**

Нарисовать кистью штрих, сохранить стены в PNG (`сохранить` → PNG), загрузить получившийся файл обратно через поле файла и замерить долю закрашенного тем же кодом, что в шаге 8.

Ожидается значение **меньше `0.1`** — виден штрих, а не залитый прямоугольник. Заливка означала бы, что картинка с прозрачным фоном ушла в режим `luma` и порог съел силуэт.

- [ ] **Шаг 10: коммит**

```bash
git add app.js
git commit -m "Анализ картинки при загрузке и предпросмотр бинаризации"
```

---

### Задача 3: ползунки порога, сглаживания и инверсия

**Файлы:**
- Изменить: `ui.js` — ветка `if (svg)` в `buildSettings` (около строки 207).
- Изменить: `app.js` — `actions` (около строки 1000), `uiState` и подпись в `updateControls`.

**Интерфейсы:**
- Потребляет: поля `svgOverlay.mode`, `.threshold`, `.blur`, `.invert`, функцию `refreshPreview()` из задачи 2.
- Отдаёт: действия `a.setThreshold(v)`, `a.setBlur(v)`, `a.toggleInvert()`. В `buildSettings` объект `svg` — это сам `svgOverlay`, у него читаются `mode`, `threshold`, `blur`, `invert`.

- [ ] **Шаг 1: добавить элементы в колонку**

В `ui.js`, в `buildSettings`, внутрь ветки `if (svg) { ... }`, **после** блока с масштабом и **до** `return`:

```js
    /* Порог нужен только непрозрачной картинке: у силуэта с прозрачным
       фоном регулировать нечего, и показывать мёртвый ползунок хуже,
       чем не показывать ничего. */
    if (svg.mode === 'luma') {
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
```

- [ ] **Шаг 2: добавить иконку**

В `index.html`, в спрайт (рядом с `<symbol id="i-hand" ...>`):

```html
<symbol id="i-invert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/></symbol>
```

- [ ] **Шаг 3: добавить действия**

В `app.js`, в объект `actions`, рядом с `setSVGScale`:

```js
  setThreshold: v => { if (!svgOverlay) return; svgOverlay.threshold = v; refreshPreview(); },
  setBlur: v => { if (!svgOverlay) return; svgOverlay.blur = v; refreshPreview(); },
  toggleInvert: () => {
    if (!svgOverlay) return;
    svgOverlay.invert = !svgOverlay.invert;
    refreshPreview();
    updateControls(true);
  },
```

Ползунки **не зовут** `updateControls`: пересборка колонки вырвала бы ползунок из-под курсора. Подпись рядом с ними правит сам `ui.js`, как у пропорции и масштаба. Кнопка инверсии — клик, а не протяжка, поэтому пересборка здесь уместна и нужна, чтобы подсветка кнопки не разошлась с состоянием.

- [ ] **Шаг 4: внести режим в подпись**

В `uiState` добавить поле:

```js
    placingSVG: !!svgOverlay, svgMode: svgOverlay?.mode || '', svgInvert: !!svgOverlay?.invert,
```

(строка `placingSVG: !!svgOverlay, growthState: growthState(),` уже есть — дописать два поля в неё).

В `updateControls`, в строку подписи, добавить оба поля:

```js
  const sig = [s.mode, s.tool, s.railWide, s.panelOpen, s.placingSVG, s.svgMode, s.svgInvert,
               s.canUndo, s.canGrow, s.growthState, s.auto, s.seeWalls, narrow].join('|');
```

Без `svgMode` колонка не перестроится, когда картинку с прозрачным фоном сменят на фотографию. Без `svgInvert` кнопка не изменит подсветку. Значения `threshold` и `blur` в подпись **не входят** — это намеренно, иначе движение ползунка будет пересобирать колонку.

- [ ] **Шаг 5: проверить синтаксис**

Выполнить: `node --check app.js && node --check ui.js`
Ожидается: молчит.

- [ ] **Шаг 6: проба — ползунок меняет картинку и не теряет фокус**

Загрузить непрозрачную картинку (код из задачи 2, шаг 7), затем:

```js
const f = document.querySelector('#colIn .field[data-key="threshold"]');
const inp = f.querySelector('input');
const ink = () => { const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let n = 0; for (let i = 0; i < cv.width*cv.height; i++) if (d[i*4] > 140) n++; return n; };
inp.focus();
const low = (inp.value = 20, inp.dispatchEvent(new Event('input', { bubbles: true })), await new Promise(r=>setTimeout(r,120)), ink());
const high = (inp.value = 80, inp.dispatchEvent(new Event('input', { bubbles: true })), await new Promise(r=>setTimeout(r,120)), ink());
[low, high, high > low, document.activeElement === inp, inp.isConnected];
```

Ожидается: `high > low` равно `true` (чем выше порог, тем больше считается стеной), `document.activeElement === inp` равно `true` и `inp.isConnected` равно `true` — ползунок не вырвало пересборкой.

- [ ] **Шаг 7: проба — сглаживание и инверсия**

```js
const bf = document.querySelector('#colIn .field[data-key="blur"] input');
const before = ink();
bf.value = 8; bf.dispatchEvent(new Event('input', { bubbles: true }));
await new Promise(r=>setTimeout(r,150));
const after = ink();
const invBtn = [...document.querySelectorAll('#colIn button.t')].find(b => b.textContent.includes('инвертировать'));
invBtn.click(); await new Promise(r=>setTimeout(r,200));
[before, after, ink(), invBtn.classList.contains('on')];
```

Ожидается: третье число заметно отличается от второго (инверсия перевернула силуэт), четвёртое равно `true`.

- [ ] **Шаг 8: проба — в режиме прозрачности ползунков нет**

Загрузить PNG с прозрачным фоном (сохранённые стены), затем:

```js
[!!document.querySelector('#colIn .field[data-key="threshold"]'),
 !!document.querySelector('#colIn .field[data-key="svgscale"]')];
```

Ожидается: `[false, true]` — порога нет, масштаб на месте.

- [ ] **Шаг 9: проба мобильного листа**

Эмулировать ширину 375 **на переднем плане** (события смены медиазапроса не доходят до фоновой вкладки), открыть настройки, загрузить непрозрачную картинку:

```js
[!!document.querySelector('#msheet .field[data-key="threshold"]'),
 !!document.querySelector('#msheet .field[data-key="blur"]'),
 document.getElementById('bar').scrollWidth <= document.getElementById('bar').clientWidth];
```

Ожидается: `[true, true, true]` — оба ползунка в листе, полоса не переполнена.

- [ ] **Шаг 10: коммит**

```bash
git add app.js ui.js index.html
git commit -m "Ползунки порога и сглаживания, кнопка инверсии в размещении картинки"
```

---

### Задача 4: запекание и документация

**Файлы:**
- Изменить: `app.js` — `applySVG` (около строки 335).
- Изменить: `README.md`, `AGENTS.md`.

**Интерфейсы:**
- Потребляет: `binarize`, `toPNG` из `picture.js`; `PREVIEW_BAKE` из задачи 2.
- Отдаёт: ничего нового; после применения `op` устроен как прежде — `{ k: 'svg', src, img, x, y, w, h }`.

- [ ] **Шаг 1: запекать при применении**

В `applySVG` заменить строку добавления операции на:

```js
  /* Запекаем один раз: дальше картинка живёт как обычная вставленная —
     её двигает ладошка, масштабирует ползунок рисунка, отменяет ⌘Z.
     В op.img кладётся холст (рисуется сразу, ждать загрузки не надо),
     в op.src — data-URL для хранилища и SVG-экспорта. */
  const baked = o.mode === 'luma'
    ? binarize(o.img, { threshold: o.threshold, blur: o.blur, invert: o.invert, maxSide: PREVIEW_BAKE })
    : null;
  wallOps.push({
    k: 'svg',
    src: baked ? toPNG(baked) : o.src,
    img: baked || o.img,
    x: o.x, y: o.y, w: overlayWidth(o), h: o.h,
  });
```

- [ ] **Шаг 2: проверить синтаксис**

Выполнить: `node --check app.js`
Ожидается: молчит.

- [ ] **Шаг 3: проба — применённая картинка стала стеной**

Загрузить непрозрачную картинку с тёмным кругом (код из задачи 2, шаг 7), нажать `применить`, затем перейти в `рост` и дать ему поработать:

```js
const btn = t => [...document.querySelectorAll('#rail button.t')].find(b => b.querySelector('.lbl').textContent === t);
btn('применить').click(); await new Promise(r => setTimeout(r, 200));
const afterApply = ink();
btn('рост').click(); await new Promise(r => setTimeout(r, 1500));
[afterApply, ink() > afterApply];
```

Ожидается: второе значение `true` — рост пошёл, то есть круг стал стеной. Если рост не стартует, кнопка `рост` заблокирована и стен в сетке нет.

- [ ] **Шаг 4: проба — переживает перезагрузку**

```js
await new Promise(r => setTimeout(r, 800));
const saved = JSON.parse(localStorage.getItem('grow.pustota.v1'));
const op = saved.ops.find(o => o.k === 'svg');
[saved.ops.length, op.src.slice(0, 22), (op.src.length / 1024).toFixed(0) + ' KB'];
```

Ожидается: операция есть, `src` начинается с `data:image/png;base64,`, размер меньше 1000 KB. После `location.reload()` картинка на холсте должна остаться на месте.

- [ ] **Шаг 5: проба — ладошка двигает запечённую картинку**

Выбрать инструмент `двигать`, протащить на 0.1 ширины и сравнить границы закрашенного до и после — смещение должно совпасть с жестом с точностью до 0.01. Метод замера — тот же, что в проверках ладошки: границы непрозрачных пикселей холста в долях его размера.

- [ ] **Шаг 6: обновить README**

В раздел «Вставка картинки» добавить:

```markdown
Непрозрачную картинку — фотографию, кадр, скриншот — приложение само переводит в двухцветную: стартовый порог считается методом Оцу, а стеной становится та сторона порога, которой меньше. Ползунки «порог» и «сглаживание» и кнопка «инвертировать» появляются только для таких картинок; у силуэта с прозрачным фоном регулировать нечего. Сглаживание размывает картинку перед порогом: на нуле видна вся мелкая крошка, дальше формы укрупняются.

Настройка живёт до «применить»: дальше картинка запекается в обычную стену, и порог у неё уже не поменять — только ⌘/Ctrl+Z и загрузить заново.
```

- [ ] **Шаг 7: обновить AGENTS.md**

В таблицу карты кода добавить строку:

```markdown
| `picture.js` | Бинаризация вставляемой картинки: анализ, порог по Оцу, размытие. Ничего не импортирует. |
```

В раздел «Не трогать без причины» добавить абзац:

```markdown
Бинаризация происходит **один раз, на входе**. Ровно поэтому ядро не знает о фотографиях: после применения картинка — обычный силуэт на прозрачном фоне, и `drawOp`, `ensureGrid` и оба экспорта работают с ней как со вставленным SVG. Не переводи это на пересчёт «на лету»: придётся править и растеризацию в сетку, и оба экспорта, и рисование.
```

- [ ] **Шаг 8: коммит**

```bash
git add app.js README.md AGENTS.md
git commit -m "Запекание бинаризованной картинки в стену, документация"
```

---

## Самопроверка плана

**Покрытие спеки.** Модуль `picture.js` — задача 1. Правило выбора режима и Оцу — задача 1, применение при загрузке — задача 2. Ползунки и инверсия, обе оболочки — задача 3. Запекание в PNG 1600 — задача 4. Сообщение об ошибке форматов — задача 2, шаг 5. Все шесть проверок из спеки разложены по задачам: режим определяется верно (задача 2, шаги 8 и 9; задача 3, шаг 8), Оцу на двух полях (задача 1, шаг 4), круг через экспорт стен (задача 2, шаг 9), сглаживание уменьшает число очагов (задача 1, шаг 6), предпросмотр не тормозит (задача 3, шаг 6 замеряет отклик ползунка), обе оболочки (задача 3, шаги 8 и 9).

**Согласованность имён.** `analyze`, `binarize`, `toPNG` объявлены в задаче 1 и используются в задачах 2 и 4 в том же виде. `refreshPreview` объявлена в задаче 2, используется в задаче 3. `PREVIEW_SIDE` и `PREVIEW_BAKE` объявлены в задаче 2, `PREVIEW_BAKE` используется в задаче 4. Поля `svgOverlay`: `mode`, `threshold`, `blur`, `invert`, `shown` — заводятся в задаче 2, читаются в задачах 3 и 4.

**Замер чернил.** Функция `ink()` из задачи 3, шаг 6 используется и в задаче 4 — при выполнении задачи 4 её надо объявить заново в той же консоли.
