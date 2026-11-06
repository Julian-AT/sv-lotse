import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFOperatorList, PDFPageProxy } from "pdfjs-dist/types/src/display/api.js";
import { z } from "zod";
import { DETECTION_CONFIG } from "./config.ts";
import { readPaths } from "./paths.ts";

export interface GlyphMetric {
  width: number;
  square?: readonly number[];
}
export type FontMetrics = Map<string, Map<string, GlyphMetric>>;
const glyphSchema = z.object({ unicode: z.string(), fontChar: z.string(), width: z.number() });
const pathSchema = z.object({ path: z.instanceof(Float32Array) });

function squareOutline(value: unknown): readonly number[] | undefined {
  const parsed = pathSchema.safeParse(value);
  if (!parsed.success) return undefined;
  for (const path of readPaths(Array.from(parsed.data.path))) {
    if (path.curved || path.points.length < 4) continue;
    const xs = path.points.map((point) => point.x),
      ys = path.points.map((point) => point.y);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      bottom = Math.min(...ys),
      top = Math.max(...ys);
    const width = right - left,
      height = top - bottom;
    if (
      width < DETECTION_CONFIG.glyphMinimumSide ||
      width > DETECTION_CONFIG.glyphMaximumSide ||
      height < DETECTION_CONFIG.glyphMinimumSide ||
      width / height < DETECTION_CONFIG.glyphMinimumAspect ||
      width / height > DETECTION_CONFIG.glyphMaximumAspect
    )
      continue;
    if (
      path.points.every(
        (point) =>
          (Math.abs(point.x - left) < DETECTION_CONFIG.glyphCornerTolerance ||
            Math.abs(point.x - right) < DETECTION_CONFIG.glyphCornerTolerance) &&
          (Math.abs(point.y - bottom) < DETECTION_CONFIG.glyphCornerTolerance ||
            Math.abs(point.y - top) < DETECTION_CONFIG.glyphCornerTolerance),
      )
    )
      return [left, bottom, right, top];
  }
  return undefined;
}

/** Read real glyph advances and square outlines, including broken symbol-font Unicode maps. */
export function fontMetrics(page: PDFPageProxy, operators: PDFOperatorList): FontMetrics {
  const fonts: FontMetrics = new Map();
  let current: Map<string, GlyphMetric> | undefined;
  let name = "";
  for (const [index, op] of operators.fnArray.entries()) {
    const args: unknown = operators.argsArray[index];
    if (!Array.isArray(args)) continue;
    if (op === OPS.setFont && typeof args[0] === "string") {
      name = args[0];
      current = fonts.get(name) ?? new Map();
      fonts.set(name, current);
    }
    if (op !== OPS.showText || !current || !Array.isArray(args[0])) continue;
    addGlyphMetrics(page, current, name, args[0]);
  }
  return fonts;
}

function addGlyphMetrics(
  page: PDFPageProxy,
  current: Map<string, GlyphMetric>,
  name: string,
  values: readonly unknown[],
): void {
  for (const value of values) {
    const parsed = glyphSchema.safeParse(value);
    if (!parsed.success || current.has(parsed.data.unicode)) continue;
    const glyph = parsed.data;
    const key = `${name}_path_${glyph.fontChar}`;
    const square = page.commonObjs.has(key) ? squareOutline(page.commonObjs.get(key)) : undefined;
    current.set(glyph.unicode, { width: glyph.width / 1000, ...(square ? { square } : {}) });
  }
}
