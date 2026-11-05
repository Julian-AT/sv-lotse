import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextCell {
  text: string;
  x: number;
  y: number;
  height: number;
}
export interface TextLine {
  y: number;
  cells: TextCell[];
}

/** Baselines within one point belong to the same row; superscripts stay separate. */
export async function readFeePages(file: string): Promise<TextLine[][]> {
  const task = getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages: TextLine[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      const cells = items
        .flatMap((item): TextCell[] => {
          if (!("str" in item) || !item.str.trim()) return [];
          const x = item.transform[4];
          const y = item.transform[5];
          if (typeof x !== "number" || typeof y !== "number") {
            throw new Error(`Invalid text coordinates on PDF page ${number}`);
          }
          return [{ text: item.str.trim(), x, y, height: item.height }];
        })
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: TextLine[] = [];
      for (const cell of cells) {
        const last = lines.at(-1);
        if (last && Math.abs(last.y - cell.y) <= 1) last.cells.push(cell);
        else lines.push({ y: cell.y, cells: [cell] });
      }
      for (const line of lines) line.cells.sort((a, b) => a.x - b.x);
      pages.push(lines);
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
