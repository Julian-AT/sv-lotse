import type { TextContent } from "pdfjs-dist/types/src/display/api.js";
import { insidePage, type Matrix, multiply, transformBox } from "../forms/detect/geometry.ts";
import { DOCUMENT_ROW_TOLERANCE_POINTS } from "./config.ts";
import type { DocumentLine } from "./schema.ts";

/** Preserve PDF strings, including spaces, and read slightly offset table cells as visual rows. */
export function textLayerLines(
  content: TextContent,
  matrix: Matrix,
  width: number,
  height: number,
  page: number,
): DocumentLine[] {
  const runs = content.items.flatMap((item) => {
    if (!("str" in item) || !item.str.length) return [];
    const transform = multiply(matrix, item.transform as Matrix);
    const scale = Math.hypot(transform[0], transform[1]);
    if (!scale) return [];
    const box = insidePage(
      transformBox(
        [0, -0.2, item.width / scale, content.styles[item.fontName]?.ascent ?? 0.8],
        transform,
        page,
      ),
      width,
      height,
    );
    return [{ text: item.str, baseline: transform[5], x: transform[4], box }];
  });
  runs.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const rows: { baseline: number; runs: typeof runs }[] = [];
  for (const run of runs) {
    const last = rows.at(-1);
    if (last && run.baseline - last.baseline <= DOCUMENT_ROW_TOLERANCE_POINTS) last.runs.push(run);
    else rows.push({ baseline: run.baseline, runs: [run] });
  }
  return rows.flatMap((row) => {
    const boxes = row.runs.flatMap((run) => (run.box ? [run.box] : []));
    if (!boxes.length) return [];
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    return [
      {
        text: row.runs
          .sort((a, b) => a.x - b.x)
          .map((run) => run.text)
          .join(" "),
        bbox: {
          x: x / width,
          y: y / height,
          width: (Math.max(...boxes.map((box) => box.x + box.width)) - x) / width,
          height: (Math.max(...boxes.map((box) => box.y + box.height)) - y) / height,
        },
      },
    ];
  });
}
