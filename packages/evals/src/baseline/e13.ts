import { resolve } from "node:path";
import { detectFields } from "@lotse/brain/forms/detect";
import { z } from "zod";
import { createE13Suite } from "../e13/index.ts";
import { EvaluationFieldSchema } from "../e13/metrics.ts";
import type { RegisteredSuite } from "../runner/index.ts";
import { checkGold, dataset, SETS, verifiedBytes } from "./data.ts";

export async function e13Suite(): Promise<RegisteredSuite> {
  const data = await dataset("E13");
  await checkGold(data.cases);
  return createE13Suite(
    data.cases.map((item) => {
      if (!item.source) throw new Error("missing_provenance");
      return {
        id: item.id,
        tags: item.tags,
        input: item.input,
        gold: z.array(EvaluationFieldSchema).parse(item.expected),
        source: item.source,
      };
    }),
    async (input, { signal }) => {
      const { document } = z
        .object({ document: z.object({ path: z.string(), sha256: z.string() }) })
        .parse(input);
      return (
        await detectFields(
          await verifiedBytes(resolve(SETS, "e13"), document.path, document.sha256),
          { signal },
        )
      ).fields;
    },
  );
}
