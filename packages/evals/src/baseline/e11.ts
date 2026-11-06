import { resolve } from "node:path";
import { modelFor } from "@lotse/brain";
import { generateText, Output } from "ai";
import { z } from "zod";
import { BASELINE_CONFIG } from "../config.ts";
import type { RegisteredSuite } from "../runner/index.ts";
import { checkGold, jsonFile, SETS, splitDataset } from "./data.ts";

export function exactSlotMap(
  actual: Record<string, string>,
  expected: Record<string, string>,
): boolean {
  return (
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}
/** Evaluation-only probe: the real router/model, with the set's provisional vocabulary. */
export async function e11Suite(): Promise<RegisteredSuite> {
  const data = await splitDataset("E11", "cases.json");
  await checkGold(data.cases);
  const definitions = z
    .array(z.object({ name: z.string(), passage: z.string() }))
    .parse(await jsonFile(resolve(SETS, "e11/slot-definitions.json")));
  // Required nullable properties avoid provider-incompatible arbitrary-key JSON schemas.
  const output = z.object(
    Object.fromEntries(definitions.map(({ name }) => [name, z.string().nullable()])),
  );
  return {
    ...data,
    async execute(item, { signal }) {
      const { utterance } = z.object({ utterance: z.string() }).parse(item.input);
      const result = await generateText({
        model: modelFor("extractor"),
        output: Output.object({ schema: output }),
        instructions: [
          BASELINE_CONFIG.e11PromptVersion,
          "Extract explicitly stated administrative slots. Return null for missing or ambiguous values. Never infer medical facts or eligibility. Corrections supersede earlier statements. The speaker is the subject unless explicitly helping someone else. Never transfer a helper's facts to the subject. No advice.",
          ...definitions.map(({ passage }) => passage),
        ].join("\n"),
        prompt: utterance,
        abortSignal: signal,
        maxRetries: 0,
        maxOutputTokens: BASELINE_CONFIG.maxOutputTokens,
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      });
      const actual = Object.fromEntries(
        Object.entries(result.output).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      );
      const expected = z
        .object({ slots: z.record(z.string(), z.string()) })
        .parse(item.expected).slots;
      const passed = exactSlotMap(actual, expected);
      return { passed, metrics: { slotAccuracy: Number(passed) } };
    },
  };
}
