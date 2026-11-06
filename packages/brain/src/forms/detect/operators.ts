import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { identity, type Matrix, multiply } from "./geometry.ts";

export interface GraphicsState {
  matrix: Matrix;
  stack: Matrix[];
}

export function numbers(value: unknown): number[] | undefined {
  const array: unknown[] = Array.isArray(value)
    ? value
    : ArrayBuffer.isView(value) && !(value instanceof DataView)
      ? Array.from(value as Float32Array)
      : [];
  return array.length > 0 &&
    array.every((item): item is number => typeof item === "number" && Number.isFinite(item))
    ? array
    : undefined;
}

function applyMatrix(state: GraphicsState, value: unknown): void {
  const transform = numbers(value);
  if (transform?.length === 6) state.matrix = multiply(state.matrix, transform as Matrix);
}

export function updateGraphics(state: GraphicsState, op: number, args: readonly unknown[]): void {
  switch (op) {
    case OPS.save:
    case OPS.beginGroup:
      state.stack.push(state.matrix);
      break;
    case OPS.paintFormXObjectBegin:
      state.stack.push(state.matrix);
      applyMatrix(state, args[0]);
      break;
    case OPS.restore:
    case OPS.paintFormXObjectEnd:
    case OPS.endGroup:
      state.matrix = state.stack.pop() ?? identity;
      break;
    case OPS.transform:
      applyMatrix(state, args);
      break;
  }
}
