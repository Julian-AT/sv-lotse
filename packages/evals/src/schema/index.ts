import { z } from "zod";

export const SuiteIdSchema = z.enum([
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6",
  "E7",
  "E8",
  "E9",
  "E10",
  "E11",
  "E12",
  "E13",
]);
export const SubsetSchema = z.enum(["pr", "nightly", "weekly"]);
const name = z.string().min(1);
const metricName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.@-]*$/);
export const SuiteSchema = z.object({
  id: SuiteIdSchema,
  name,
  gate: z.object({
    kind: z.enum(["blocking", "informational"]),
    metric: metricName,
    threshold: z.number().finite(),
    direction: z.enum(["at_least", "at_most"]).default("at_least"),
  }),
  minimumSetSize: z.number().int().nonnegative(),
});
export const SourceSchema = z.object({ uri: z.url(), passage: name });
const caseFields = { id: name, tags: z.array(name), input: z.json(), expected: z.json() };
export const CaseSchema = z.discriminatedUnion("kind", [
  z.object({ ...caseFields, kind: z.literal("gold"), source: SourceSchema }),
  z.object({ ...caseFields, kind: z.literal("synthetic"), source: SourceSchema.optional() }),
]);
export const JudgeVersionSchema = z.object({
  model: name,
  rubricId: name,
  rubricVersion: name,
  promptVersion: name,
});
export const JudgeResultSchema = z.object({
  ...JudgeVersionSchema.shape,
  scores: z.record(
    name,
    z.object({ score: z.number().int().min(0).max(2), rationale: z.string().min(1).max(600) }),
  ),
});
export const EvaluationSchema = z.object({
  passed: z.boolean(),
  metrics: z
    .record(metricName, z.number().finite())
    .refine((metrics) => !("passRate" in metrics), "passRate is reserved"),
  judge: JudgeResultSchema.optional(),
});
export const ReducedMetricsSchema = z
  .record(metricName, z.number().finite().nullable())
  .refine((metrics) => !("passRate" in metrics), "passRate is reserved");
export const CaseResultSchema = z.object({
  caseId: name,
  status: z.enum(["passed", "failed", "error", "timeout"]),
  attempts: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  metrics: z.record(metricName, z.number().finite()),
  error: z.enum(["transport", "execution", "invalid_result", "timeout"]).optional(),
  judge: JudgeResultSchema.optional(),
});
export const IntervalSchema = z
  .object({
    lower: z.number().min(0).max(1),
    upper: z.number().min(0).max(1),
    confidence: z.number().gt(0).lt(1),
  })
  .refine((interval) => interval.lower <= interval.upper);
export const SuiteResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    suite: SuiteSchema,
    selection: z.object({
      subset: SubsetSchema.optional(),
      sample: z.number().int().nonnegative().optional(),
      seed: name,
    }),
    counts: z.object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
    }),
    metrics: z.record(metricName, z.number().finite().nullable()),
    wilson95: IntervalSchema.nullable(),
    gateVerdict: z.enum(["passed", "failed", "insufficient_data"]),
    modelVersion: name,
    judgeVersions: z.array(JudgeVersionSchema),
    gitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    cases: z.array(CaseResultSchema),
  })
  .superRefine((result, context) => {
    const { total, passed, failed, errors } = result.counts;
    if (
      total !== result.cases.length ||
      total !== passed + failed + errors ||
      passed !== result.cases.filter((item) => item.status === "passed").length ||
      failed !== result.cases.filter((item) => item.status === "failed").length
    ) {
      context.addIssue({ code: "custom", message: "Result counts disagree with cases" });
    }
    if (new Set(result.cases.map((item) => item.caseId)).size !== total) {
      context.addIssue({ code: "custom", message: "Duplicate result case IDs" });
    }
    if (result.finishedAt < result.startedAt)
      context.addIssue({ code: "custom", message: "Invalid result timestamps" });
  });
export const SummarySchema = z.object({
  schemaVersion: z.literal(1),
  suites: z.array(SuiteResultSchema),
  blockingFailures: z.array(SuiteIdSchema),
});
export type EvalCase = z.infer<typeof CaseSchema>;
export type Suite = z.infer<typeof SuiteSchema>;
export type CaseResult = z.infer<typeof CaseResultSchema>;
export type SuiteResult = z.infer<typeof SuiteResultSchema>;
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;
