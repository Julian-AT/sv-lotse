import { z } from "zod";
import type { RegisteredSuite, Registry } from "../runner/index.ts";
import { CaseSchema, SourceSchema } from "../schema/index.ts";
import {
  type EvaluationField,
  EvaluationFieldSchema,
  FieldCountsSchema,
  measureFields,
  summarizeFields,
} from "./metrics.ts";

const FixtureSchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()),
  input: z.json(),
  gold: z.array(EvaluationFieldSchema).min(1),
  source: SourceSchema,
});
export type E13Fixture = z.infer<typeof FixtureSchema>;
export type FieldDetector = (
  input: z.infer<typeof CaseSchema>["input"],
  context: { signal: AbortSignal },
) => Promise<readonly EvaluationField[]>;

/** Hosts supply source-backed fixtures and an adapter, avoiding a dependency on the brain. */
export function createE13Suite(
  fixtures: readonly E13Fixture[],
  detect: FieldDetector,
): RegisteredSuite {
  const parsed = z.array(FixtureSchema).parse(fixtures);
  return {
    suite: {
      id: "E13",
      name: "Form field detection",
      minimumSetSize: 20,
      gate: {
        kind: "informational",
        metric: "targetAttainment",
        threshold: 1,
        direction: "at_least",
      },
    },
    cases: parsed.map((fixture) =>
      CaseSchema.parse({
        id: fixture.id,
        kind: "gold",
        tags: fixture.tags,
        input: fixture.input,
        expected: fixture.gold,
        source: fixture.source,
      }),
    ),
    async execute(item, context) {
      context.signal.throwIfAborted();
      const detected = await detect(item.input, context);
      context.signal.throwIfAborted();
      const metrics = measureFields(detected, z.array(EvaluationFieldSchema).parse(item.expected));
      return { passed: metrics.targetAttainment >= 1, metrics };
    },
    reduce(results) {
      const totals = {
        goldCount: 0,
        detectedCount: 0,
        matchedCount: 0,
        boxMatchedCount: 0,
        labelMatchedCount: 0,
        ownerMatchedCount: 0,
      };
      for (const result of results) {
        // The runner retains errors and marks incomplete metric coverage as null.
        if (result.status === "error" || result.status === "timeout") continue;
        const counts = FieldCountsSchema.parse(result.metrics);
        totals.goldCount += counts.goldCount;
        totals.detectedCount += counts.detectedCount;
        totals.matchedCount += counts.matchedCount;
        totals.boxMatchedCount += counts.boxMatchedCount;
        totals.labelMatchedCount += counts.labelMatchedCount;
        totals.ownerMatchedCount += counts.ownerMatchedCount;
      }
      return summarizeFields(totals);
    },
  };
}

export function registerE13(
  registry: Registry,
  fixtures: readonly E13Fixture[],
  detect: FieldDetector,
): void {
  registry.register(createE13Suite(fixtures, detect));
}

export { intersectionOverUnion, measureFields } from "./metrics.ts";
