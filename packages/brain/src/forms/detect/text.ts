import { formDetectionVocabulary } from "@lotse/knowledge/form-detection";
import declarations from "@lotse/knowledge/form-owner-declarations" with { type: "json" };
import type { TextContent } from "pdfjs-dist/types/src/display/api.js";
import { z } from "zod";
import { DETECTION_CONFIG } from "./config.ts";
import type { FontMetrics, GlyphMetric } from "./fonts.ts";
import { type Matrix, multiply, transformBox } from "./geometry.ts";
import patterns from "./owner-patterns.json" with { type: "json" };
import { type FieldBox, type FieldOwner, FieldOwnerSchema, type FieldType } from "./schema.ts";

export interface TextRun {
  text: string;
  box: FieldBox;
  baseline?: number;
  fontHeight?: number;
  advances?: number[];
  square?: boolean;
}
const ownerPatterns = z
  .array(z.object({ owner: FieldOwnerSchema, patterns: z.array(z.string()) }))
  .parse([...patterns, ...declarations, ...formDetectionVocabulary.owners])
  .map((item) => ({
    owner: item.owner,
    expressions: item.patterns.map((pattern) => new RegExp(pattern, "iu")),
  }));

export function textRuns(
  content: TextContent,
  matrix: Matrix,
  page: number,
  fonts?: FontMetrics,
): TextRun[] {
  return content.items.flatMap((item) => {
    if (!("str" in item) || !item.str.trim()) return [];
    const transform = multiply(matrix, item.transform as Matrix);
    const scale = Math.hypot(transform[0], transform[1]);
    if (scale === 0) return [];
    const ascent = content.styles[item.fontName]?.ascent || DETECTION_CONFIG.defaultAscent;
    const box = transformBox(
      [0, DETECTION_CONFIG.defaultDescent, item.width / scale, ascent],
      transform,
      page,
    );
    const font = fonts?.get(item.fontName);
    const text = item.str.trim();
    const scaled = glyphAdvances(text, font, box.width);
    const runs: TextRun[] = [
      {
        text,
        box,
        baseline: transform[5],
        fontHeight: Math.hypot(transform[2], transform[3]),
        advances: scaled,
      },
    ];
    const symbols = [...text].flatMap((character, index) => {
      const square = font?.get(character)?.square;
      return square ? [{ index, square }] : [];
    });
    if (symbols.length === 0) return runs;
    const result: TextRun[] = [];
    let start = 0;
    for (const symbol of symbols) {
      appendTextSlice(result, runs[0], start, symbol.index, scaled);
      const offset = scaled[symbol.index] ?? 0;
      const symbolBox = transformBox(symbol.square, transform, page);
      result.push({ text: "☐", box: { ...symbolBox, x: symbolBox.x + offset }, square: true });
      start = symbol.index + 1;
    }
    appendTextSlice(result, runs[0], start, text.length, scaled);
    return result;
  });
}

export function sectionHeaders(
  runs: readonly TextRun[],
): { y: number; owner: FieldOwner; box: FieldBox }[] {
  // Join nearby fragments so a header split across PDF text operators is still recognized.
  const lines: TextRun[] = [];
  for (const run of [...runs].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const line = lines.find(
      (item) =>
        Math.abs(item.box.y - run.box.y) < 3 &&
        run.box.x >= item.box.x &&
        run.box.x - item.box.x - item.box.width < 24,
    );
    if (line) {
      if (!line.text.endsWith(run.text)) line.text += ` ${run.text}`;
      line.box.width = Math.max(line.box.width, run.box.x + run.box.width - line.box.x);
    } else lines.push({ text: run.text, box: { ...run.box } });
  }
  return [...runs, ...lines]
    .flatMap((run) => {
      let text = run.text;
      let box = { ...run.box };
      let previous = run;
      // Owner headings can wrap over up to three nearby, left-aligned lines.
      for (let count = 1; count <= 3; count++) {
        const normalized = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
        const rule = ownerPatterns.find((item) =>
          item.expressions.some((expression) => expression.test(normalized)),
        );
        if (rule) return [{ y: box.y, owner: rule.owner, box }];
        const next = lines.find(
          (item) =>
            item.box.page === box.page &&
            item.box.y > previous.box.y + 3 &&
            item.box.y - previous.box.y - previous.box.height <= Math.max(6, previous.box.height) &&
            Math.abs(item.box.x - run.box.x) < 24,
        );
        if (!next) break;
        text += ` ${next.text}`;
        const x = Math.min(box.x, next.box.x);
        box = {
          ...box,
          x,
          width: Math.max(box.x + box.width, next.box.x + next.box.width) - x,
          height: next.box.y + next.box.height - box.y,
        };
        previous = next;
      }
      return [];
    })
    .sort((a, b) => a.y - b.y);
}

export function fieldOwner(
  y: number,
  headers: ReturnType<typeof sectionHeaders>,
  initial: FieldOwner,
  box?: FieldBox,
  pageWidth = Number.POSITIVE_INFINITY,
): FieldOwner {
  let owner = initial;
  for (const header of headers) {
    if (header.y > y + 3) break;
    if (
      box &&
      header.box.x > pageWidth * DETECTION_CONFIG.columnOwnerPosition &&
      header.box.x > box.x + box.width
    )
      continue;
    owner = header.owner;
  }
  return owner;
}

export function associateLabel(
  box: FieldBox,
  runs: readonly TextRun[],
  checkbox: boolean,
): string | undefined {
  const ranked = runs
    .filter((run) => /[\p{L}\p{N}]/u.test(run.text))
    .map((run) => {
      const text = run.box;
      const centerY = box.y + box.height / 2;
      const dy = Math.abs(text.y + text.height / 2 - centerY);
      const leftGap = box.x - text.x - text.width;
      const rightGap = text.x - box.x - box.width;
      const aboveGap = box.y - text.y - text.height;
      const belowGap = text.y - box.y - box.height;
      const horizontalOverlap =
        Math.min(box.x + box.width, text.x + text.width) - Math.max(box.x, text.x);
      let score = Infinity;
      if (leftGap >= -2 && leftGap <= 150 && dy <= Math.max(10, box.height / 2 + 3))
        score = leftGap + dy * 3;
      if (checkbox && rightGap >= -2 && rightGap < 100 && dy < 15)
        score = Math.min(score, rightGap + dy * 2);
      if (!checkbox && belowGap >= -3 && belowGap < 16 && horizontalOverlap > 0)
        score = Math.min(score, 24 + Math.max(0, belowGap) * 2 + Math.abs(text.x - box.x) * 0.15);
      if (aboveGap >= -3 && aboveGap < 35 && horizontalOverlap > 0)
        score = Math.min(score, 20 + Math.max(0, aboveGap) * 2 + Math.abs(text.x - box.x) * 0.15);
      if (
        text.x >= box.x - 2 &&
        text.y >= box.y - 2 &&
        text.x + text.width <= box.x + box.width + 2 &&
        text.y < box.y + box.height
      )
        score = Math.min(score, 25 + text.y - box.y);
      return { run, score };
    })
    .sort((a, b) => a.score - b.score);
  const best = ranked[0];
  return best && Number.isFinite(best.score) ? best.run.text : undefined;
}

export function inferType(label: string, checkbox = false): FieldType {
  if (checkbox) return "checkbox";
  if (/unterschrift|signatur/iu.test(label)) return "signature";
  if (/datum|geburts(?:tag|datum)|tt\s*[./-]\s*mm\s*[./-]\s*j{2,4}/iu.test(label)) return "date";
  if (/anzahl|betrag|einkommen|postleitzahl|\bplz\b|nummer|\bnr\.?\b/iu.test(label))
    return "number";
  return "text";
}

/** Analyze sideways content upright, then transform answers back to the displayed CropBox. */
export function textOrientation(content: TextContent, viewport: Matrix): number {
  const weights = new Map<number, number>();
  for (const item of content.items) {
    if (!("str" in item) || !/[\p{L}\p{N}]/u.test(item.str)) continue;
    const matrix = multiply(viewport, item.transform as Matrix);
    const angle = (Math.round((Math.atan2(matrix[1], matrix[0]) * 2) / Math.PI) * 90 + 360) % 360;
    weights.set(angle, (weights.get(angle) ?? 0) + item.str.length);
  }
  return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function glyphAdvances(
  text: string,
  font: Map<string, GlyphMetric> | undefined,
  width: number,
): number[] {
  const advances = [0];
  for (const character of text)
    advances.push(
      (advances.at(-1) ?? 0) +
        (font?.get(character)?.width ?? DETECTION_CONFIG.defaultGlyphAdvance),
    );
  const total = advances.at(-1) || 1;
  return advances.map((value) => (value / total) * width);
}

function appendTextSlice(
  result: TextRun[],
  run: TextRun | undefined,
  start: number,
  end: number,
  advances: readonly number[],
): void {
  if (!run) return;
  const slice = run.text.slice(start, end);
  const text = slice.trim();
  if (!text) return;
  const textStart = start + slice.indexOf(text);
  const left = advances[textStart] ?? 0;
  const right = advances[textStart + text.length] ?? run.box.width;
  result.push({
    ...run,
    text,
    box: { ...run.box, x: run.box.x + left, width: right - left },
    advances: advances.slice(textStart, textStart + text.length + 1).map((value) => value - left),
  });
}
