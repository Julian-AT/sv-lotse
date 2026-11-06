import { z } from "zod";

export const TURN_LEASE_MS = 5 * 60_000;

export const modelRoles = [
  "orchestrator",
  "classifier",
  "guard",
  "extractor",
  "embedding",
] as const;
export type ModelRole = (typeof modelRoles)[number];
const optionalOverride = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);
const modelName = z.string().trim().min(1);
const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  APPROVAL_HMAC_SECRET: z.string().min(32),
  BRAIN_ALLOW_STUBS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["0", "1"]).default("0"),
  ),
  OPENAI_MODEL_ORCHESTRATOR: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_CLASSIFIER: optionalOverride(modelName.default("gpt-5.4-nano")),
  OPENAI_MODEL_GUARD: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_EXTRACTOR: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_EMBEDDING: optionalOverride(modelName.default("text-embedding-3-small")),
  OPENAI_MODEL_ORCHESTRATOR_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_CLASSIFIER_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_GUARD_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_EXTRACTOR_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_EMBEDDING_FALLBACK: optionalOverride(modelName.optional()),
});

export function parseBrainConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(
      `Invalid brain configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path[0]))].join(", ")}`,
    );
  }
  const value = parsed.data;
  return {
    apiKey: value.OPENAI_API_KEY,
    approvalSecret: value.APPROVAL_HMAC_SECRET,
    allowStubs: value.BRAIN_ALLOW_STUBS === "1",
    models: {
      orchestrator: {
        primary: value.OPENAI_MODEL_ORCHESTRATOR,
        fallback: value.OPENAI_MODEL_ORCHESTRATOR_FALLBACK,
      },
      classifier: {
        primary: value.OPENAI_MODEL_CLASSIFIER,
        fallback: value.OPENAI_MODEL_CLASSIFIER_FALLBACK,
      },
      guard: { primary: value.OPENAI_MODEL_GUARD, fallback: value.OPENAI_MODEL_GUARD_FALLBACK },
      extractor: {
        primary: value.OPENAI_MODEL_EXTRACTOR,
        fallback: value.OPENAI_MODEL_EXTRACTOR_FALLBACK,
      },
      embedding: {
        primary: value.OPENAI_MODEL_EMBEDDING,
        fallback: value.OPENAI_MODEL_EMBEDDING_FALLBACK,
      },
    },
  };
}
export type BrainConfig = ReturnType<typeof parseBrainConfig>;
