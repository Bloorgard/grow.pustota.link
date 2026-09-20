# Порог для картинок, доработка — план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-НАВЫК: `superpowers:subagent-driven-development` (рекомендуется) или `superpowers:executing-plans`. Шаги помечены чекбоксами (`- [ ]`).

**Цель.** Научить приложение правильно обращаться с фотографией, заранее вырезанной из фона, дать ручной переключатель бинаризации и вставку картинки из буфера.

**Архитектура.** Правило выбора уточняется в `picture.js` (одна функция `analyze`), переключатель добавляется в уже существующий блок настроек размещения, вставка из буфера переиспользует существующий путь загрузки файла. Ядро не трогается.

**Стек.** Нативные ES-модули, Canvas 2D, ванильный JS. Сборки нет, зависимостей нет и добавлять их нельзя.

**Спека.** `docs/superpowers/specs/2026-09-21-picture-threshold-follow-up-design.md`.

## Глобальные ограничения

- Интерфейс русский строчными буквами: `два тона`, `порог`, `сглаживание`, `инвертировать`.
- Комментарии в коде русские, по делу, без пересказа очевидного. Сообщения коммитов русские.
- Новых зависимостей и шагов сборки нет. Только нативные модули.
- Зависимости односторонние, циклов нет: `field.js` и `picture.js` не импортируют ничего, `ui.js` импортирует только `field.js`, всё сводит `app.js`.
- Проверка — только через `python3 docs/superpowers/plans/serve.py` (отдаёт `Cache-Control: no-store`). С обычным `python3 -m http.server` браузер держит прежний модуль и пробы врут.
- Перед каждой пробой с измерением — `localStorage.clear()` и полная перезагрузка: приложение восстанавливает прежний рисунок, и числа будут от старого состояния.
- Синтетические события указателя — только с `pointerId: 1`.
- Тестового раннера нет и добавлять не надо. Проверка — `node --check` и пробы в браузере **с конкретным ожидаемым числом**.
- Инвариант: новое состояние, влияющее на вид, обязано попасть в подпись `updateControls`. Значения ползунков в подпись не входят намеренно.
- Инвариант: новый элемент управления нужен в обеих оболочках — колонка и мобильный лист. Обе собирает `buildSettings`, но проверять надо оба.

## Структура файлов

| Файл | Что с ним происходит |
|------|----------------------|
| `picture.js` | `analyze` возвращает `binary` вместо `mode`; добавляется расчёт разброса яркостей. |
| `app.js` | `svgOverlay.mode` → `svgOverlay.binary`; новое действие `toggleBinary`; подпись `updateControls`; обработчик `paste`. |
| `ui.js` | Кнопка «два тона» и условие показа ползунков. |
| `README.md`, `AGENTS.md` | Обновляются в задаче 3. |

---

### Задача 1: правило выбора и переключатель

**Файлы:**
- Изменить: `picture.js` — `analyze`, константы рядом с `CLEAR_SHARE`.
- Изменить: `app.js` — `bakedImage`, `loadPicture`, `uiState`, подпись в `updateControls`, объект `actions`.
- Изменить: `ui.js` — ветка `if (svg)` в `buildSettings`.

**Интерфейсы:**
- Отдаёт: `analyze(img) -> { binary, threshold, invert }`, где `binary` — булево. Поле `svgOverlay.mode` исчезает, вместо него `svgOverlay.binary`. Действие `a.toggleBinary()`.

- [ ] **Шаг 1: заменить правило в `analyze`**

В `picture.js` заменить константу `CLEAR_SHARE` и всю функцию `analyze` на:

```js
/* Доля прозрачных пикселей больше этой — объект вырезан из фона.
   Пять процентов: полупрозрачная кайма по краю занимает единицы процентов. */
const CLEAR_SHARE = 0.05;

/* Доля двух самых крупных корзин гистограммы выше этой — плоская графика:
   логотип, надпись, наши же экспортированные стены. Ниже — фотография.
   У силуэта с мягким краем две корзины собирают больше 0.9, у фотографии
   редко набирается и половина, так что 0.7 стоит с запасом в обе стороны. */
const PLAIN_SHARE = 0.7;
const BINS = 32;

export function analyze(img) {
  const { canvas, g } = drawScaled(img, 400);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const total = canvas.width * canvas.height;
  const hist = new Uint32Array(256);
  const bins = new Uint32Array(BINS);
  let clear = 0;
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] < 250) { clear += 1; continue; }
    const v = lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) | 0;
    hist[v] += 1;
    bins[(v * BINS / 256) | 0] += 1;
  }
  const opaque = total - clear;
  if (!opaque) return { binary: false, threshold: 50, invert: false };

  /* Два вопроса, а не один. Непрозрачной картинке порог нужен всегда —
     иначе стеной станет весь её прямоугольник. Вырезанной из фона он нужен
     только тогда, когда внутри силуэта настоящая фотография, а не заливка. */
  const cutOut = clear > total * CLEAR_SHARE;
  const top = [...bins].sort((a, b) => b - a);
  const plain = (top[0] + top[1]) / opaque > PLAIN_SHARE;
  const binary = !cutOut || !plain;

  const cut = otsu(hist, opaque);
  let dark = 0;
  for (let v = 0; v < cut; v += 1) dark += hist[v];
  /* Стеной становится меньшинство: тёмный объект на светлом фоне или
     светлый на тёмном. Промах поправляется кнопкой «инвертировать». */
  return { binary, threshold: Math.round(cut / 255 * 100), invert: dark > opaque / 2 };
}
```

- [ ] **Шаг 2: перевести `app.js` на `binary`**

Три места. В `bakedImage`:

```js
function bakedImage(o, maxSide) {
  return o.binary
    ? binarize(o.img, { threshold: o.threshold, blur: o.blur, invert: o.invert, maxSide })
    : null;
}
```

В `loadPicture`, в `img.onload`, где разбирается результат `analyze`:

```js
      const { binary, threshold, invert } = analyze(img);
      svgOverlay = {
        img, src, ia, h, baseH: h,
        x: (1 - w) / 2, y: (1 - h) / 2,
        dragging: false, grabDx: 0, grabDy: 0,
        binary, threshold, blur: 0, invert, shown: img,
      };
      refreshPreview();
```

В `uiState` — заменить поле `svgMode` на `svgBinary`:

```js
    placingSVG: !!svgOverlay, svgBinary: !!svgOverlay?.binary, svgInvert: !!svgOverlay?.invert, growthState: growthState(),
```

И в строке подписи `sig` внутри `updateControls` заменить `s.svgMode` на `s.svgBinary`.

- [ ] **Шаг 3: добавить действие**

В объект `actions`, рядом с `toggleInvert`:

```js
  toggleBinary: () => {
    if (!svgOverlay) return;
    svgOverlay.binary = !svgOverlay.binary;
    refreshPreview();
    updateControls(true);
  },
```

- [ ] **Шаг 4: кнопка в настройках**

В `ui.js`, в `buildSettings`, в ветке `if (svg)`: строку `if (svg.mode === 'luma') {` заменить на `if (svg.binary) {`, а **перед** этим условием — добавить кнопку, которая видна всегда:

```js
    /* Автомат ошибается на пограничных картинках, поэтому переключатель
       виден всегда: им и включают порог, и отказываются от него. */
    const bin = document.createElement('button');
    bin.type = 'button';
    bin.className = 't ghost wide-btn' + (svg.binary ? ' on' : '');
    bin.innerHTML = icon('contrast') + '<span class="lbl">два тона</span>';
    bin.addEventListener('click', a.toggleBinary);
    root.append(bin);
```

- [ ] **Шаг 5: добавить иконку**

В `index.html`, в спрайт, рядом с `<symbol id="i-invert" ...>`:

```html
<symbol id="i-contrast" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 8h5"/><path d="M12 12h7"/><path d="M12 16h5"/></symbol>
```

- [ ] **Шаг 6: проверить синтаксис**

Выполнить: `node --check picture.js && node --check app.js && node --check ui.js`
Ожидается: молчит.

- [ ] **Шаг 7: проба — вырезанная фотография получает порог**

На странице (сервер `python3 docs/superpowers/plans/serve.py`, адрес `http://127.0.0.1:8777/`):

```js
const { analyze } = await import('/picture.js?v=' + Date.now());
const make = paint => { const c = document.createElement('canvas'); c.width = 300; c.height = 300;
  const g = c.getContext('2d'); paint(g); const i = new Image(); i.src = c.toDataURL();
  return new Promise(r => i.onload = () => r(i)); };
/* вырезанный объект: прозрачный фон, внутри круга градиент */
const photo = await make(g => { const grad = g.createLinearGradient(0,0,300,300);
  grad.addColorStop(0,'#000'); grad.addColorStop(1,'#fff');
  g.fillStyle = grad; g.beginPath(); g.arc(150,150,120,0,7); g.fill(); });
analyze(photo).binary;
```

Ожидается: `true` — прозрачности много, но внутри силуэта разброс яркостей.

- [ ] **Шаг 8: проба — плоский силуэт порога не получает**

```js
const flat = await make(g => { g.fillStyle = '#fff'; g.beginPath(); g.arc(150,150,120,0,7); g.fill(); });
analyze(flat).binary;
```

Ожидается: `false` — прозрачный фон и один тон внутри.

- [ ] **Шаг 9: проба — непрозрачная картинка получает порог всегда**

```js
const logo = await make(g => { g.fillStyle = '#fff'; g.fillRect(0,0,300,300);
  g.fillStyle = '#111'; g.fillRect(40,120,220,60); });
analyze(logo).binary;
```

Ожидается: `true` — тонов всего два, но прозрачности нет, и без порога стеной стал бы весь прямоугольник.

- [ ] **Шаг 10: проба — кнопка перебивает автомат**

Загрузить плоский силуэт через поле файла (`#svg-file`), затем:

```js
const ink = () => { const cv = document.getElementById('canvas');
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let n = 0; for (let i = 0; i < cv.width*cv.height; i++) if (d[i*4] > 140) n++; return n; };
const btn = () => [...document.querySelectorAll('#colIn button.t')].find(b => b.textContent.includes('два тона'));
const before = [!!document.querySelector('#colIn .field[data-key="threshold"]'), btn().classList.contains('on'), ink()];
btn().click(); await new Promise(r => setTimeout(r, 250));
const after = [!!document.querySelector('#colIn .field[data-key="threshold"]'), btn().classList.contains('on'), ink()];
[before, after];
```

Ожидается: `before` даёт `[false, false, N]`, `after` — `[true, true, M]`, где ползунки появились, кнопка подсветилась, а `M` отличается от `N` (силуэт пересчитан по порогу).

- [ ] **Шаг 11: проба мобильного листа**

Эмулировать ширину 375 на переднем плане, открыть настройки, загрузить картинку:

```js
[!!document.querySelector('#msheet button.t'),
 [...document.querySelectorAll('#msheet button.t')].some(b => b.textContent.includes('два тона'))];
```

Ожидается: `[true, true]`.

- [ ] **Шаг 12: коммит**

```bash
git add picture.js app.js ui.js index.html
git commit -m "Порог включается по разбросу яркостей, кнопка «два тона» перебивает автомат"
```

---

### Задача 2: вставка из буфера

**Файлы:**
- Изменить: `app.js` — рядом с обработчиками `dragover`/`drop` в конце файла.

**Интерфейсы:**
- Потребляет: существующую `loadPicture(file)`.
- Отдаёт: ничего нового.

- [ ] **Шаг 1: добавить обработчик**

В `app.js`, рядом с обработчиками `dragover` и `drop` на холсте:

```js
/* Вставка из буфера: тот же путь, что у выбранного файла. Буфер без
   картинки молча игнорируется — вставка текста в рисовалку не ошибка
   пользователя, а промах мимо цели, сообщать о нём не о чем. */
document.addEventListener('paste', event => {
  const item = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  const file = item.getAsFile();
  if (!file) return;
  event.preventDefault();
  loadPicture(file);
});
```

- [ ] **Шаг 2: проверить синтаксис**

Выполнить: `node --check app.js`
Ожидается: молчит.

- [ ] **Шаг 3: проба — вставка картинки начинает размещение**

```js
window.__e = []; addEventListener('error', e => __e.push(e.message));
const c = document.createElement('canvas'); c.width = 200; c.height = 200;
const g = c.getContext('2d'); g.fillStyle = '#ddd'; g.fillRect(0,0,200,200);
g.fillStyle = '#222'; g.beginPath(); g.arc(100,100,70,0,7); g.fill();
const blob = await new Promise(r => c.toBlob(r, 'image/png'));
const dt = new DataTransfer(); dt.items.add(new File([blob], 'clip.png', { type: 'image/png' }));
document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
await new Promise(r => setTimeout(r, 500));
[document.getElementById('note').textContent, __e.length];
```

Ожидается: `['размещение картинки', 0]`.

- [ ] **Шаг 4: проба — буфер с текстом ничего не делает**

```js
const before = document.getElementById('note').textContent;
const dt2 = new DataTransfer(); dt2.setData('text/plain', 'просто текст');
document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true }));
await new Promise(r => setTimeout(r, 300));
[before, document.getElementById('note').textContent,
 document.getElementById('message').hidden, __e.length];
```

Ожидается: подпись не изменилась, `message` скрыт (`true`), ошибок 0.

- [ ] **Шаг 5: коммит**

```bash
git add app.js
git commit -m "Вставка картинки из буфера"
```

---

### Задача 3: документация

**Файлы:**
- Изменить: `README.md`, `AGENTS.md`.

**Интерфейсы:** ничего.

- [ ] **Шаг 1: обновить README**

В разделе «Вставка картинки» заменить абзац, начинающийся словами «Непрозрачную картинку», на:

```markdown
Картинку, которой нужен порог, приложение определяет само и отвечает на два вопроса. Непрозрачной он нужен всегда — иначе стеной станет весь её прямоугольник. Вырезанной из фона — только если внутри силуэта настоящая фотография, а не заливка: у логотипа и у наших же экспортированных стен почти все пиксели лежат в одном-двух тонах, у фотографии растянуты по всей шкале.

Автомат ошибается на пограничных картинках, поэтому решение переключаемое: кнопка «два тона» видна всё время, пока идёт размещение. Вместе с ней появляются и прячутся «порог», «сглаживание» и «инвертировать». Выключить её у непрозрачной картинки можно — тогда стеной станет весь прямоугольник, иногда нужен именно он.

Стартовый порог считается методом Оцу, стеной становится та сторона порога, которой меньше. Сглаживание размывает картинку перед порогом: на нуле видна вся мелкая крошка, дальше формы укрупняются.

Настройка живёт до «применить»: дальше картинка запекается в обычную стену, и порог у неё уже не поменять — только ⌘/Ctrl+Z и загрузить заново.
```

В разделе «Управление» добавить строку:

```markdown
- ⌘/Ctrl+V — вставить картинку из буфера
```

- [ ] **Шаг 2: обновить AGENTS.md**

В разделе «Не трогать без причины», в абзац про бинаризацию, дописать:

```markdown
Правило «нужен ли порог» отвечает на **два** вопроса, а не на один: непрозрачной картинке он нужен всегда, вырезанной из фона — только при широком разбросе яркостей внутри силуэта. Не своди это обратно к одной доле прозрачности: именно так фотография, заранее вырезанная из фона, оказывалась без единого регулятора.
```

Числа строк в карте кода пересчитать (`wc -l`) и поправить.

- [ ] **Шаг 3: коммит**

```bash
git add README.md AGENTS.md
git commit -m "Документация: два вопроса о пороге, вставка из буфера"
```

---

## Самопроверка плана

**Покрытие спеки.** Правило из двух вопросов — задача 1, шаг 1. Кнопка «два тона» и условие показа ползунков — задача 1, шаги 3–5. Замена `mode` на `binary` — задача 1, шаг 2. Вставка из буфера и молчание на тексте — задача 2. Все семь проверок спеки разложены: вырезанная фотография (задача 1, шаг 7), силуэт (шаг 8), непрозрачная картинка (шаг 9), кнопка в обе стороны (шаг 10), вставка (задача 2, шаг 3), буфер с текстом (задача 2, шаг 4), обе оболочки (задача 1, шаг 11).

**Согласованность имён.** `analyze` возвращает `binary` (задача 1, шаг 1), и это же поле читают `bakedImage`, `loadPicture`, `uiState` (шаг 2), `actions.toggleBinary` (шаг 3) и `buildSettings` (шаг 4). Старое `mode` не остаётся нигде — проверить `grep -n "\.mode\|svgMode" app.js ui.js picture.js` после шага 4; единственные совпадения должны относиться к режиму приложения (`mode === 'walls'`), а не к картинке.

**Иконка.** `icon('contrast')` из задачи 1, шаг 4 опирается на символ `#i-contrast`, добавляемый в шаге 5.
