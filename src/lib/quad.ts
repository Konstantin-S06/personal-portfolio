/** Logical size (CSS px) of the sheet that carries the invisible controls for one painted board. */
export const BOARD_W_PX = 1024;
export const BOARD_H_PX = 682;
/** The job board is two signs wide on one sheet. */
export const JOB_W_PX = BOARD_W_PX * 2;
export const JOB_H_PX = BOARD_H_PX;

/** CSS matrix3d that maps the rectangle (0,0)-(w,h) onto four screen points (TL, TR, BR, BL). '' if degenerate. */
export function quadMatrix(w: number, h: number, q: number[]): string {
  const src = [0, 0, w, 0, w, h, 0, h];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const x = src[2 * i];
    const y = src[2 * i + 1];
    const u = q[2 * i];
    const v = q[2 * i + 1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return '';
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j];
    }
  }
  const s = A.map((row, i) => row[8] / row[i]);
  if (s.some((n) => !Number.isFinite(n))) return '';
  const [a, b, c, d, e, f, g, h2] = s;
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h2},0,0,1,0,${c},${f},0,1)`;
}