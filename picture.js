/* Бинаризация картинки: на входе Image, на выходе холст с силуэтом на
   прозрачном фоне. Модуль не знает о приложении и ничего не импортирует.

   Смысл: после бинаризации фотография становится обычной вставленной
   картинкой, и ядро (показ, сетка столкновений, экспорт) не меняется. */

const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/* Уменьшенная копия: анализ и предпросмотр не должны зависеть от того,
   принесли фотографию 400 пикселей или 6000. */
function drawScaled(img, maxSide) {
  /* 300 — запасной размер, согласованный со старым путём в app.js
     (там же подставлялось 300 при отсутствии собственных размеров). */
  const iw = img.naturalWidth || img.width || 300;
  const ih = img.naturalHeight || img.height || 300;
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
  let sumB = 0, countB = 0, bestFrom = 128, bestTo = 128, bestVariance = -1;
  for (let v = 0; v < 256; v += 1) {
    countB += hist[v];
    if (!countB) continue;
    const countF = total - countB;
    if (!countF) break;
    sumB += v * hist[v];
    const meanB = sumB / countB;
    const meanF = (sum - sumB) / countF;
    const between = countB * countF * (meanB - meanF) ** 2;
    /* Плато: у двух ровных пиков дисперсия одинакова на всём промежутке
       между ними, и порог надо ставить посередине, а не у первого края. */
    if (between > bestVariance) { bestVariance = between; bestFrom = v; bestTo = v; }
    else if (between === bestVariance) bestTo = v;
  }
  return (bestFrom + bestTo) >> 1;
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

/* Доля прозрачных пикселей больше этой — объект вырезан из фона.
   Пять процентов: полупрозрачная кайма по краю занимает единицы процентов. */
const CLEAR_SHARE = 0.05;

/* Доля двух самых крупных корзин гистограммы выше этой — плоская графика:
   логотип, надпись, наши же экспортированные стены. Ниже — фотография.
   У силуэта с мягким краем две корзины собирают больше 0.9, у фотографии
   редко набирается и половина, так что 0.7 стоит с запасом в обе стороны. */
const PLAIN_SHARE = 0.7;
const BINS = 32;

/* Единица ползунка — один пиксель на копии длиной BLUR_BASE. Копий две,
   разного размера (предпросмотр и запекание), и без пересчёта одно и то же
   значение размывало бы их с разной силой: предпросмотр обещал бы одно,
   а применение давало другое. */
const BLUR_BASE = 700;

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

export function binarize(img, { threshold, blur = 0, invert = false, maxSide = 1600 }) {
  const { canvas, g } = drawScaled(img, maxSide);
  const image = g.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const total = canvas.width * canvas.height;
  const luma = new Uint8ClampedArray(total);
  const solid = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    solid[i] = data[i * 4 + 3] >= 250 ? 1 : 0;
    /* Прозрачное при размытии считается светлым: иначе полупрозрачная кайма
       затягивает соседние пиксели ниже порога и обрастает ложной стеной. */
    luma[i] = solid[i] ? lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) : 255;
  }
  const radius = Math.round(blur * Math.max(canvas.width, canvas.height) / BLUR_BASE);
  const smooth = boxBlur(luma, canvas.width, canvas.height, radius);
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
