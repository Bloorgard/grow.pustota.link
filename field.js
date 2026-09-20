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
