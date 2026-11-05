import { z } from "zod";

const ModelConfigSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  EVAL_JUDGE_MODEL: z.string().trim().min(1).default("gpt-4.1-mini"),
  EVAL_PERSONA_MODEL: z.string().trim().min(1).default("gpt-4.1-mini"),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/** Called only when an evaluation needs a provider; the demonstration stays offline. */
export function readModelConfig(): ModelConfig {
  return ModelConfigSchema.parse(process.env);
}

export const BASELINE_CONFIG = {
  concurrency: 12,
  timeoutMs: 180_000,
  maxOutputTokens: 2048,
  retrievalK: 10,
  extractionPrecision: 0.98,
  extractionRecall: 0.9,
  seed: "baseline-2026-11-06",
  e11PromptVersion: "slot-probe/1",
  defaultOutput: "docs/evals/artifacts/summary.json",
} as const;

export const E7_CONFIG = {
  formCount: 7,
  personasPerForm: 3,
  sessionLifetimeMs: 3_600_000,
} as const;

export const E4_CONFIG = {
  version: "persisted-turn/1",
  maxTurns: 12,
  timeoutMs: 600_000,
  concurrency: 4,
  sessionMs: 3_600_000,
  minimumReleaseRuns: 300,
  successThreshold: 0.9,
  defaultOutput: "docs/evals/artifacts/e4/summary.json",
} as const;
