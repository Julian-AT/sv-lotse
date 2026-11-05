import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFOperatorList } from "pdfjs-dist/types/src/display/api.js";
import { DETECTION_CONFIG } from "./config.ts";
import { identity, type Matrix, multiply, overlap, transformBox } from "./geometry.ts";
import { gridCandidates, mergeRules, type Rule } from "./grid.ts";
import { type GraphicsState, numbers, updateGraphics } from "./operators.ts";
import { readPaths } from "./paths.ts";
import type { FieldBox } from "./schema.ts";
import type { TextRun } from "./text.ts";

export interface Candidate {
  box: FieldBox;
  checkbox: boolean;
  method: "vector" | "text";
  confidence: number;
  label?: string;
  comb?: boolean;
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
  const vertical: Rule[] = [];
  const state: GraphicsState = { matrix: identity, stack: [] };
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
    if (op === undefined) continue;
    updateGraphics(state, op, args);
    const commands = paintCommands(op, args);
    if (commands)
      addPaths(
        commands,
        multiply(viewport, state.matrix),
        page,
        result,
        lines,
        vertical,
        args[0] === OPS.fill || args[0] === OPS.eoFill,
      );
  }
  appendRules(result, lines, vertical, page);
  return result;
}

export function textCandidates(runs: readonly TextRun[]): Candidate[] {
  return runs.flatMap((run): Candidate[] => {
    const fontHeight = run.fontHeight ?? run.box.height;
    const baseline = run.baseline ?? run.box.y + run.box.height;
    if (run.square) {
      const width = Math.max(run.box.width, DETECTION_CONFIG.minimumCheckboxSide);
      const height = Math.max(run.box.height, DETECTION_CONFIG.minimumCheckboxSide);
      return [
        {
          box: {
            ...run.box,
            x: run.box.x - (width - run.box.width) / 2,
            y: run.box.y - (height - run.box.height) / 2,
            width,
            height,
          },
          checkbox: true,
          method: "text",
          confidence: 0.85,
        },
      ];
    }
    if (/^[□☐❑\uf0a8]$/u.test(run.text)) {
      const size = fontHeight * DETECTION_CONFIG.fallbackGlyphSize;
      return [
        {
          box: {
            ...run.box,
            x: run.box.x + fontHeight * DETECTION_CONFIG.fallbackGlyphInset,
            y: baseline - fontHeight * DETECTION_CONFIG.fallbackGlyphAscent,
            width: size,
            height: size,
          },
          checkbox: true,
          method: "text",
          confidence: 0.85,
        },
      ];
    }
    return [...run.text.matchAll(/_{3,}|\.{5,}|…{2,}/gu)]
      .filter(
        (match) =>
          match[0].startsWith("_") ||
          !/[\p{L}\p{N}]/u.test(run.text.slice(match.index + match[0].length)),
      )
      .map((match) => ({
        box: {
          ...run.box,
          x:
            run.box.x +
            (run.advances?.[match.index] ?? run.box.width * (match.index / run.text.length)),
          width: run.advances
            ? (run.advances[match.index + match[0].length] ?? run.box.width) -
              (run.advances[match.index] ?? 0)
            : (run.box.width * match[0].length) / run.text.length,
          y:
            baseline -
            (match[0].startsWith("_")
              ? Math.min(
                  DETECTION_CONFIG.writingHeight,
                  fontHeight * DETECTION_CONFIG.inlineWritingScale,
                )
              : DETECTION_CONFIG.writingHeight),
          height: match[0].startsWith("_")
            ? Math.min(
                DETECTION_CONFIG.writingHeight,
                fontHeight * DETECTION_CONFIG.inlineWritingScale,
              )
            : DETECTION_CONFIG.writingHeight,
        },
        checkbox: false,
        method: "text" as const,
        confidence: 0.65,
        label:
          run.text.slice(0, match.index).trim() ||
          run.text.slice(match.index + match[0].length).trim(),
      }));
  });
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
      if (
        candidate.box.width > DETECTION_CONFIG.maximumCombCellWidth ||
        candidate.box.height > DETECTION_CONFIG.maximumCombCellHeight
      ) {
        used.add(candidate);
        return [candidate];
      }
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
      const { group, right } = consecutiveCells(candidate, cells);
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
          comb: true,
        },
      ];
    });
}

/** A serial number and its date suffix can use different character-cell widths. */
export function mergeCombSegments(candidates: readonly Candidate[]): Candidate[] {
  const result: Candidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const previous = result.find(
      (other) =>
        other.comb &&
        candidate.comb &&
        other.box.page === candidate.box.page &&
        Math.abs(other.box.y - candidate.box.y) < 1 &&
        Math.abs(other.box.height - candidate.box.height) < 1 &&
        candidate.box.x - other.box.x - other.box.width >= -1 &&
        candidate.box.x - other.box.x - other.box.width <= DETECTION_CONFIG.compoundCombGap,
    );
    if (previous) previous.box.width = candidate.box.x + candidate.box.width - previous.box.x;
    else result.push({ ...candidate, box: { ...candidate.box } });
  }
  return result;
}

function addPaths(
  commands: readonly number[],
  matrix: Matrix,
  page: number,
  result: Candidate[],
  lines: FieldBox[],
  vertical: Rule[],
  fillOnly: boolean,
): void {
  for (const path of readPaths(commands)) {
    if (path.curved || path.points.length < 2) continue;
    const xs = path.points.map((point) => point.x),
      ys = path.points.map((point) => point.y);
    const minX = Math.min(...xs),
      minY = Math.min(...ys),
      maxX = Math.max(...xs),
      maxY = Math.max(...ys);
    const box = transformBox([minX, minY, maxX, maxY], matrix, page);
    // Shading and text backgrounds are not borders. Thin filled strips are real rules.
    if (
      fillOnly &&
      box.width > DETECTION_CONFIG.lineTolerance &&
      box.height > DETECTION_CONFIG.lineTolerance
    )
      continue;
    const rectangular =
      path.points.length >= 4 &&
      path.points.every(
        (point) =>
          (Math.abs(point.x - minX) < 0.5 || Math.abs(point.x - maxX) < 0.5) &&
          (Math.abs(point.y - minY) < 0.5 || Math.abs(point.y - maxY) < 0.5),
      );
    addEdges(path.points, path.closed, matrix, page, lines, vertical);
    if (rectangular && box.width >= 5 && box.height >= 5 && box.height <= 150) {
      result.push({ box, checkbox: isCheckbox(box), method: "vector", confidence: 0.85 });
    } else if (box.width >= 1 && box.height < 1.5) {
      lines.push({ ...box, y: box.y + box.height / 2, height: 0 });
    }
  }
}

function appendRules(result: Candidate[], lines: FieldBox[], vertical: Rule[], page: number): void {
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
  const grid = gridCandidates(
    merged.map((line) => ({ start: line.x, end: line.x + line.width, at: line.y })),
    vertical,
    page,
  );
  result.push(...grid);
  for (const line of merged) {
    const covered = mergeRules(
      grid
        .filter(
          (cell) =>
            Math.abs(line.y - cell.box.y) <= 2 ||
            Math.abs(line.y - cell.box.y - cell.box.height) <= 2,
        )
        .map((cell) => ({ at: line.y, start: cell.box.x, end: cell.box.x + cell.box.width })),
    ).some((rule) => rule.start <= line.x + 2 && rule.end >= line.x + line.width - 2);
    if (covered) continue;
    if (line.width >= 25)
      result.push({
        box: {
          ...line,
          y: line.y - DETECTION_CONFIG.writingHeight,
          height: DETECTION_CONFIG.writingHeight,
        },
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
}

function addEdges(
  points: readonly { x: number; y: number }[],
  closed: boolean,
  matrix: Matrix,
  page: number,
  lines: FieldBox[],
  vertical: Rule[],
): void {
  const displayed = points.map((point) =>
    transformBox([point.x, point.y, point.x, point.y], matrix, page),
  );
  const edges = closed ? [...displayed, displayed[0]] : displayed;
  for (let edge = 1; edge < edges.length; edge++) {
    const a = edges[edge - 1],
      b = edges[edge];
    if (!a || !b) continue;
    if (Math.abs(a.y - b.y) < 1.5 && Math.abs(a.x - b.x) >= 1)
      lines.push({
        page,
        x: Math.min(a.x, b.x),
        y: (a.y + b.y) / 2,
        width: Math.abs(a.x - b.x),
        height: 0,
      });
    if (Math.abs(a.x - b.x) < 1.5 && Math.abs(a.y - b.y) >= 5)
      vertical.push({
        at: (a.x + b.x) / 2,
        start: Math.min(a.y, b.y),
        end: Math.max(a.y, b.y),
      });
  }
}

function consecutiveCells(
  candidate: Candidate,
  cells: readonly Candidate[],
): { group: Candidate[]; right: number } {
  const group: Candidate[] = [candidate];
  let right = candidate.box.x + candidate.box.width;
  for (const cell of cells) {
    if (cell.box.x < right - 1) continue;
    if (cell.box.x - right > 2) break;
    group.push(cell);
    right = cell.box.x + cell.box.width;
  }

  return { group, right };
}

function paintCommands(op: number, args: readonly unknown[]): number[] | undefined {
  if (op !== OPS.constructPath || args[0] === OPS.endPath) return undefined;
  const packed = Array.isArray(args[1]) ? args[1] : [];
  return numbers(packed[0]);
}
