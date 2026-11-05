import { Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { FieldBox } from "./schema.ts";

export type Matrix = [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(a: Matrix, b: Matrix): Matrix {
  return Util.transform(a, b) as Matrix;
}

export function transformBox(rect: readonly number[], matrix: Matrix, page: number): FieldBox {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
  const points = [
    [x0, y0],
    [x0, y1],
    [x1, y0],
    [x1, y1],
  ].map(([x = 0, y = 0]) => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ]);
  const xs = points.map((point) => point[0] ?? 0);
  const ys = points.map((point) => point[1] ?? 0);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { page, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function overlap(a: FieldBox, b: FieldBox): number {
  if (a.page !== b.page) return 0;
  const area =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return area / (a.width * a.height + b.width * b.height - area);
}

export function insidePage(box: FieldBox, width: number, height: number): FieldBox | undefined {
  const x = Math.max(0, box.x),
    y = Math.max(0, box.y);
  const right = Math.min(width, box.x + box.width),
    bottom = Math.min(height, box.y + box.height);
  if (right <= x || bottom <= y) return undefined;
  return { ...box, x, y, width: right - x, height: bottom - y };
}
