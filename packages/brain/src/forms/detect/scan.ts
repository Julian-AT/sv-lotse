import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFOperatorList } from "pdfjs-dist/types/src/display/api.js";
import { DETECTION_CONFIG } from "./config.ts";
import { identity, type Matrix, multiply, transformBox } from "./geometry.ts";
import { type GraphicsState, updateGraphics } from "./operators.ts";
import type { TextRun } from "./text.ts";

/** A full-page scan may retain a page number or a small searchable footer. */
export function needsVision(
  runs: readonly TextRun[],
  operators: PDFOperatorList,
  viewport: Matrix,
  area: number,
  vectorFieldCount = Number.POSITIVE_INFINITY,
): boolean {
  const characters = runs.reduce(
    (sum, run) => sum + (run.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0),
    0,
  );
  if (characters === 0) return true;
  if (
    vectorFieldCount < DETECTION_CONFIG.minimumVectorFields &&
    characters <= DETECTION_CONFIG.maximumSparseFormCharacters &&
    runs.filter((run) => /[:_□☐]/u.test(run.text)).length >= DETECTION_CONFIG.minimumFormPrompts
  )
    return true;
  if (characters >= DETECTION_CONFIG.scanTextCharacters) return false;
  const state: GraphicsState = { matrix: identity, stack: [] };
  let imageArea = 0;
  for (const [index, op] of operators.fnArray.entries()) {
    const args: unknown = operators.argsArray[index];
    if (!Array.isArray(args)) continue;
    updateGraphics(state, op, args);
    if (op !== OPS.paintImageXObject && op !== OPS.paintInlineImageXObject) continue;
    const box = transformBox([0, 0, 1, 1], multiply(viewport, state.matrix), 1);
    imageArea += box.width * box.height;
  }
  return imageArea / area >= DETECTION_CONFIG.scanImageCoverage;
}
