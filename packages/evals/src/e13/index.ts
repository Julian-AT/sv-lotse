import { z } from "zod";
import type { RegisteredSuite, Registry } from "../runner/index.ts";
import { CaseSchema, SourceSchema } from "../schema/index.ts";
import { type EvaluationField, EvaluationFieldSchema, measureFields } from "./metrics.ts";

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
      // Both informational targets must hold; keep box-only recall separately for AC2.
      const targetAttainment = Math.min(metrics.recall / 0.9, metrics.precision / 0.95, 1);
      return { passed: targetAttainment >= 1, metrics: { ...metrics, targetAttainment } };
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
