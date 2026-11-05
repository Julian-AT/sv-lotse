import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFOperatorList } from "pdfjs-dist/types/src/display/api.js";
import { identity, type Matrix, multiply, overlap, transformBox } from "./geometry.ts";
import type { FieldBox } from "./schema.ts";
import type { TextRun } from "./text.ts";

export interface Candidate {
  box: FieldBox;
  checkbox: boolean;
  method: "vector" | "text";
  confidence: number;
  label?: string;
}
interface Point {
  x: number;
  y: number;
}

function numbers(value: unknown): number[] | undefined {
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

/** PDF.js 6 packs DrawOPS (move=0, line=1, cubic=2, quadratic=3, close=4). */
function paths(data: readonly number[]): { points: Point[]; closed: boolean; curved: boolean }[] {
  const result: { points: Point[]; closed: boolean; curved: boolean }[] = [];
  let path = { points: [] as Point[], closed: false, curved: false };
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 4) {
      path.closed = true;
      continue;
    }
    if (op === 0 && path.points.length) {
      result.push(path);
      path = { points: [], closed: false, curved: false };
    }
    const length = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 ? 4 : 0;
    if (length === 0 || i + length > data.length) break;
    if (op === 2 || op === 3) path.curved = true;
    const x = data[i + length - 2],
      y = data[i + length - 1];
    if (x !== undefined && y !== undefined) path.points.push({ x, y });
    i += length;
  }
  if (path.points.length) result.push(path);
  return result;
}

function isCheckbox(box: FieldBox): boolean {
  return (
    box.width >= 5 &&
    box.width <= 24 &&
    box.height >= 5 &&
    box.height <= 24 &&
    box.width / box.height >= 0.7 &&
    box.width / box.height <= 1.4
  );
}

export function vectorCandidates(
  operators: PDFOperatorList,
  viewport: Matrix,
  page: number,
): Candidate[] {
  const result: Candidate[] = [];
  const lines: FieldBox[] = [];
  let matrix = identity;
  const stack: Matrix[] = [];
  let annotation = false;
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i];
    const raw: unknown = operators.argsArray[i];
    const args: unknown[] = Array.isArray(raw) ? raw : [];
    if (op === OPS.beginAnnotation) {
      annotation = true;
      continue;
    }
    if (op === OPS.endAnnotation) {
      annotation = false;
      continue;
    }
    if (annotation) continue;
    if (op === OPS.save || op === OPS.paintFormXObjectBegin || op === OPS.beginGroup) {
      stack.push(matrix);
      if (op === OPS.paintFormXObjectBegin) {
        const transform = numbers(args[0]);
        if (transform?.length === 6) matrix = multiply(matrix, transform as Matrix);
      }
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd || op === OPS.endGroup) {
      matrix = stack.pop() ?? identity;
    } else if (op === OPS.transform) {
      const transform = numbers(args);
      if (transform?.length === 6) matrix = multiply(matrix, transform as Matrix);
    } else if (op === OPS.constructPath && args[0] !== OPS.endPath) {
      const packed: unknown[] = Array.isArray(args[1]) ? args[1] : [];
      const commands = numbers(packed[0]);
      if (!commands) continue;
      for (const path of paths(commands)) {
        if (path.curved || path.points.length < 2) continue;
        const xs = path.points.map((point) => point.x),
          ys = path.points.map((point) => point.y);
        const minX = Math.min(...xs),
          minY = Math.min(...ys),
          maxX = Math.max(...xs),
          maxY = Math.max(...ys);
        const box = transformBox([minX, minY, maxX, maxY], multiply(viewport, matrix), page);
        const rectangular =
          path.points.length >= 4 &&
          path.points.every(
            (point) =>
              (Math.abs(point.x - minX) < 0.5 || Math.abs(point.x - maxX) < 0.5) &&
              (Math.abs(point.y - minY) < 0.5 || Math.abs(point.y - maxY) < 0.5),
          );
        if (rectangular && box.width >= 5 && box.height >= 5 && box.height <= 150) {
          result.push({ box, checkbox: isCheckbox(box), method: "vector", confidence: 0.85 });
        } else if (box.width >= 1 && box.height < 1.5) {
          lines.push({ ...box, y: box.y + box.height / 2, height: 0 });
        }
      }
    }
  }
  // Merge dash segments on a shared baseline; leave separated answer areas distinct.
  const merged: FieldBox[] = [];
  for (const line of lines.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = merged.find(
      (item) =>
        Math.abs(item.y - line.y) < 1 && line.x >= item.x && line.x <= item.x + item.width + 6,
    );
    if (previous) previous.width = Math.max(previous.width, line.x + line.width - previous.x);
    else merged.push({ ...line });
  }
  for (const line of merged) {
    if (line.width >= 25)
      result.push({
        box: { ...line, y: line.y - 12, height: 12 },
        checkbox: false,
        method: "vector",
        confidence: 0.6,
      });
    // Open ruled layouts often have a short upper rule and a shared lower rule.
    // Their endpoints partition adjacent answer areas without requiring widgets.
    const lower = merged
      .filter(
        (other) =>
          other.y - line.y >= 8 &&
          other.y - line.y <= 45 &&
          Math.abs(other.x + other.width - line.x - line.width) < 2 &&
          other.x <= line.x + 1,
      )
      .sort((a, b) => a.y - b.y)[0];
    if (!lower || line.width < 25) continue;
    const height = lower.y - line.y;
    result.push({ box: { ...line, height }, checkbox: false, method: "vector", confidence: 0.75 });
    if (line.x - lower.x >= 25)
      result.push({
        box: { ...lower, y: line.y, width: line.x - lower.x, height },
        checkbox: false,
        method: "vector",
        confidence: 0.75,
      });
  }
  return result;
}

export function textCandidates(runs: readonly TextRun[]): Candidate[] {
  return runs.flatMap((run) =>
    [...run.text.matchAll(/_{3,}|\.{5,}|…{2,}/gu)].map((match) => ({
      box: {
        ...run.box,
        x: run.box.x + run.box.width * (match.index / run.text.length),
        width: (run.box.width * match[0].length) / run.text.length,
        height: Math.max(12, run.box.height),
      },
      checkbox: false,
      method: "text" as const,
      confidence: 0.65,
      label:
        run.text.slice(0, match.index).trim() ||
        run.text.slice(match.index + match[0].length).trim(),
    })),
  );
}

export function deduplicateCandidates(candidates: readonly Candidate[]): Candidate[] {
  const result: Candidate[] = [];
  for (const candidate of [...candidates].sort(
    (a, b) =>
      b.confidence - a.confidence || b.box.width * b.box.height - a.box.width * a.box.height,
  )) {
    if (!result.some((item) => overlap(item.box, candidate.box) >= 0.65)) result.push(candidate);
  }
  // Start at the leftmost cell regardless of drawing order; emit each cell only once.
  const used = new Set<Candidate>();
  return result
    .sort((a, b) => a.box.page - b.box.page || a.box.x - b.box.x || a.box.y - b.box.y)
    .flatMap((candidate) => {
      if (used.has(candidate)) return [];
      const cells = result
        .filter(
          (item) =>
            !used.has(item) &&
            item.box.page === candidate.box.page &&
            Math.abs(item.box.y - candidate.box.y) < 1 &&
            Math.abs(item.box.height - candidate.box.height) < 1 &&
            Math.abs(item.box.width - candidate.box.width) < 1,
        )
        .sort((a, b) => a.box.x - b.box.x);
      const group: Candidate[] = [candidate];
      let right = candidate.box.x + candidate.box.width;
      for (const cell of cells) {
        if (cell.box.x < right - 1) continue;
        if (cell.box.x - right > 2) break;
        group.push(cell);
        right = cell.box.x + cell.box.width;
      }
      if (group.length < 3) {
        used.add(candidate);
        return [candidate];
      }
      for (const item of group) used.add(item);
      return [
        {
          ...candidate,
          box: { ...candidate.box, width: right - candidate.box.x },
          checkbox: false,
        },
      ];
    });
}
