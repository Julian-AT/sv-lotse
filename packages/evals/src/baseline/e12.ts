import { resolve } from "node:path";
import {
  type DocumentPage,
  type DocumentStatement,
  extractDocumentStatements,
  readDocumentPages,
} from "@lotse/brain/documents";
import { z } from "zod";
import { BASELINE_CONFIG } from "../config.ts";
import type { RegisteredSuite } from "../runner/index.ts";
import { checkGold, dataset, normalized, ROOT, verifiedBytes } from "./data.ts";

const annotations = z.object({
  annotations: z.array(z.object({ quote: z.string(), page: z.number(), factType: z.string() })),
});
type Annotation = z.infer<typeof annotations>["annotations"][number];
/** Full quotation/page matching; no semantic or substring credit. One gold span counts once. */
export function matchStatements(
  actual: readonly DocumentStatement[],
  gold: readonly Annotation[],
): number {
  const unused = new Set(gold.map((_, index) => index));
  let matches = 0;
  for (const statement of actual) {
    const index = gold.findIndex(
      (item, index) =>
        unused.has(index) &&
        item.page === statement.page &&
        normalized(item.quote) === normalized(statement.quote) &&
        statement.type ===
          (item.factType === "documented_recommendation"
            ? "documented_recommendation"
            : "administrative_fact"),
    );
    if (index >= 0) {
      unused.delete(index);
      matches++;
    }
  }
  return matches;
}
function syntheticPages(texts: string[]): DocumentPage[] {
  // Text fixtures have no physical geometry. Supply an explicit normalized line layout;
  // this checks grounding, not OCR or the accuracy of physical bounding boxes.
  return texts.map((text, index) => {
    const lines = text.split("\n");
    return {
      page: index + 1,
      text,
      width: 1,
      height: 1,
      method: "device_ocr",
      lines: lines.map((text, index) => ({
        text,
        bbox: { x: 0, y: index / lines.length, width: 1, height: 1 / lines.length },
      })),
    };
  });
}
export async function e12Suite(): Promise<RegisteredSuite> {
  const data = await dataset("E12");
  await checkGold(data.cases);
  return {
    ...data,
    async execute(item, { signal }) {
      const { document } = z
        .object({
          document: z.discriminatedUnion("origin", [
            z.object({ origin: z.literal("svbox"), path: z.string(), sha256: z.string() }),
            z.object({ origin: z.literal("synthetic"), pages: z.array(z.string()) }),
          ]),
        })
        .parse(item.input);
      const pages =
        document.origin === "svbox"
          ? await readDocumentPages(
              await verifiedBytes(
                resolve(ROOT, process.env.SVBOX_DIR ?? "data/svbox"),
                document.path,
                document.sha256,
              ),
              signal,
            )
          : syntheticPages(document.pages);
      const actual = await extractDocumentStatements(pages, signal);
      const gold = annotations.parse(item.expected).annotations;
      const matchedCount = matchStatements(actual, gold);
      const precision = actual.length ? matchedCount / actual.length : 0;
      const recall = matchedCount / gold.length;
      return {
        passed:
          precision >= BASELINE_CONFIG.extractionPrecision &&
          recall >= BASELINE_CONFIG.extractionRecall,
        metrics: {
          matchedCount,
          predictedCount: actual.length,
          goldCount: gold.length,
          precision,
          recall,
        },
      };
    },
    reduce(results) {
      const sum = (key: string): number =>
        results.reduce((total, result) => total + (result.metrics[key] ?? 0), 0);
      const matchedCount = sum("matchedCount"),
        predictedCount = sum("predictedCount"),
        goldCount = sum("goldCount");
      return {
        matchedCount,
        predictedCount,
        goldCount,
        precision: predictedCount ? matchedCount / predictedCount : 0,
        recall: goldCount ? matchedCount / goldCount : 0,
      };
    },
  };
}
