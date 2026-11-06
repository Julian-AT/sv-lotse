import { z } from "zod";
import { findQuoteRanges } from "./quote.ts";

const box = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
const pageSchema = z.object({
  page: z.number().int().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  lines: z.array(z.object({ text: z.string(), bbox: box })),
});
export type HighlightBox = z.infer<typeof box>;

/** Pipeline boxes use top-left page coordinates; unsupported metadata falls back to PDF text. */
export function storedQuoteBoxes(
  pages: readonly unknown[],
  page: number,
  quote: string,
  width: number,
  height: number,
): HighlightBox[] {
  for (const raw of pages) {
    const parsed = pageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.page !== page) continue;
    const data = parsed.data;
    return findQuoteRanges(
      data.lines.map((line) => line.text),
      quote,
    ).flatMap(({ index }) => {
      const line = data.lines[index];
      return line
        ? [
            {
              x: (line.bbox.x * width) / data.width,
              y: (line.bbox.y * height) / data.height,
              width: (line.bbox.width * width) / data.width,
              height: (line.bbox.height * height) / data.height,
            },
          ]
        : [];
    });
  }
  return [];
}
