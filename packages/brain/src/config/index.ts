import { z } from "zod";
import { knowledgeAssetUrl } from "./assets.ts";

export const RESOLVE_MAX_BODY_BYTES = 2_800_000;
export const RESOLVE_TIMEOUT_MS = 15_000;
export const RESOLVE_MAX_IMAGE_BYTES = 2_000_000;
export const RESOLVE_MIN_CONFIDENCE = 0.8;
export const FORM_CORRECTION_FACT_TYPE = "form.field.correction";

// Standard USD rates per million tokens, checked 2026-11-06:
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
// https://developers.openai.com/api/docs/models/gpt-5.4-nano
export const MODEL_PRICING = {
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
};
export const TOKENS_PER_MILLION = 1_000_000;

const pricingSchema = z.record(
  z.string().min(1),
  z
    .object({
      input: z.number().nonnegative().finite(),
      cachedInput: z.number().nonnegative().finite(),
      output: z.number().nonnegative().finite(),
    })
    .strict(),
);

export const TURN_LEASE_MS = 5 * 60_000;
export const LANGUAGE_CLASSIFIER_TIMEOUT_MS = 10_000;
export const LANGUAGE_CLASSIFIER_MAX_OUTPUT_TOKENS = 512;
export const CATALOG_SEARCH_MIN_TERM_LENGTH = 4;

export const CATALOG_FACT_TYPES = {
  age: "age",
  sex: "sex",
  familyHistory: "family_history",
  vaccination: "vaccination_record",
} as const;

export const CASE_FILE_CONFIG = {
  maxTitleLength: 200,
  pdf: { width: 595.28, height: 841.89, margin: 48, fontSize: 11, lineHeight: 16 },
  defaultHandoffScope: ["steps", "documents", "reminders"] as const,
  zipLevel: 0 as const,
};

export const BOOKING_ALLOWLIST_FILE = knowledgeAssetUrl("allowlist.yaml");

export const JOB_LEASE_MS = 5 * 60_000;
export const JOB_STEP_TIMEOUT_MS = 60_000;
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_BATCH_SIZE = 5;
export const JOB_MAX_STEPS = 20;
export const JOB_RETRY_DELAY_MS = 30_000;
export const JOB_RUN_BUDGET_MS = 180_000;

// Only repeatable reads and draft generation may run without a live approval flow.
export const BACKGROUND_TOOL_NAMES = [
  "catalog.findBenefits",
  "catalog.getBenefit",
  "kb.search",
  "office.resolve",
  "facility.search",
  "appointment.search",
  "form.find",
  "form.getSchema",
  "package.build",
  "context.queryFacts",
  "reminder.list",
] as const;

export const CATALOG_MAX_CANDIDATES = 8;
export const CONTEXT_FORM_LIMIT = 3;
export const CATALOG_MIN_TOKEN_LENGTH = 4;
export const CATALOG_LIFE_SITUATION_WEIGHT = 10;
export const CATALOG_QUERY_MAX_LENGTH = 200;
export const PROCESS_DAY_MS = 86_400_000;

export const DIRECTORY_CONFIG = {
  earthRadiusKm: 6371.0088,
  calendarLineOctets: 75,
  calendarProductId: "-//SV KI-Lotse//Appointment preparation//DE",
  timeZone: "Europe/Vienna",
  ambiguousPlaceRadiusKm: 25,
  weekMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export const FORM_TYPE_PACE_MS = 65;
export const FORM_DOWNLOAD_TIMEOUT_MS = 30_000;
export const FORM_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const FORM_DOWNLOAD_MAX_REDIRECTS = 5;
export const FORM_SEARCH_LIMIT = 20;
export const FORM_SEARCH_PAGE_LIMIT = 3;
export const FORM_SEARCH_REQUEST_LIMIT = 6;
export const FORM_PDF_FONT_SIZE = 10;
export const FORM_PDF_FONT_HEIGHT_RATIO = 0.7;
export const FORM_GEOMETRY_EPSILON = 0.01;

export const PIPELINE_CONFIG = {
  contextTokens: 16_000,
  charsPerToken: 4,
  /** The last three exchanges; older turns are summarised by the case block. */
  recentMessages: 6,
  /** As much of a passage as the composer reads, so a table's last rows stay visible. */
  agentPassageCharacters: 1_000,
  retrievalK: 8,
  candidateLimit: 50,
  rrfConstant: 60,
  retrievalWeights: [0.5, 1],
  modelTimeoutMs: 60_000,
  turnTimeoutMs: 240_000,
  classifierTimeoutMs: 8_000,
  guardTimeoutMs: 12_000,
  maxSteps: 12,
  maxOutputTokens: 2048,
  /** Prose a lookup step writes before the turn is released without it (a tool-call preamble is shorter). */
  earlyReleaseCharacters: 120,
} as const;

export const CONTEXT_SHARES = {
  policy: 20,
  profile: 5,
  case: 10,
  facts: 15,
  knowledge: 30,
  screen: 10,
  history: 10,
} as const;

export const KNOWLEDGE_SYNONYMS_URL = knowledgeAssetUrl("synonyms.yaml");
export const KNOWLEDGE_ROOT = new URL("./", KNOWLEDGE_SYNONYMS_URL);
export const GOAL_CONFIRMATION_URL = knowledgeAssetUrl("guards/goal-confirmation.yaml");

// Preserve existing public config names while sharing the explicitly traced asset URLs.
export const SYNONYMS_FILE = KNOWLEDGE_SYNONYMS_URL;
export const GOAL_CONFIRMATION_FILE = GOAL_CONFIRMATION_URL;

export const modelRoles = [
  "orchestrator",
  "classifier",
  "guard",
  "extractor",
  "embedding",
  "vision",
] as const;
export type ModelRole = (typeof modelRoles)[number];

const optionalOverride = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);
const modelName = z.string().trim().min(1);
// Reasoning effort per model role; unset keeps the provider default (and the composer's own).
const reasoningEffort = optionalOverride(
  z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
);
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
const environmentSchema = z.object({
  LOTSE_CASE_BUDGET_USD: optionalOverride(z.coerce.number().positive().finite().optional()),
  LOTSE_MODEL_PRICING_JSON: z.preprocess((value) => {
    if (value === undefined || value === "") return MODEL_PRICING;
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }, pricingSchema),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: optionalOverride(z.url().optional()),
  OPENAI_EMBEDDING_BASE_URL: optionalOverride(z.url().optional()),
  OPENAI_EMBEDDING_API_KEY: optionalOverride(z.string().min(1).optional()),
  OPENAI_RESPONSES_STORE: optionalOverride(z.enum(["true", "false"]).optional()),
  APPROVAL_HMAC_SECRET: z.string().min(32),
  BRAIN_ALLOW_STUBS: optionalOverride(z.literal("0").default("0")),
  OPENAI_MODEL_ORCHESTRATOR: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_CLASSIFIER: optionalOverride(modelName.default("gpt-5.4-nano")),
  OPENAI_MODEL_GUARD: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_EXTRACTOR: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_VISION: optionalOverride(modelName.default("gpt-5.4-mini")),
  OPENAI_MODEL_VISION_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_EMBEDDING: optionalOverride(modelName.optional()),
  EMBEDDING_MODEL: optionalOverride(modelName.optional()),
  OPENAI_MODEL_ORCHESTRATOR_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_CLASSIFIER_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_GUARD_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_EXTRACTOR_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_MODEL_EMBEDDING_FALLBACK: optionalOverride(modelName.optional()),
  OPENAI_REASONING_EFFORT_ORCHESTRATOR: reasoningEffort,
  OPENAI_REASONING_EFFORT_CLASSIFIER: reasoningEffort,
  OPENAI_REASONING_EFFORT_GUARD: reasoningEffort,
  // The extractor role also composes the spoken answer.
  OPENAI_REASONING_EFFORT_EXTRACTOR: reasoningEffort,
  OPENAI_REASONING_EFFORT_VISION: reasoningEffort,
  // OpenAI processing tier for every model call; "priority" trades price for lower latency.
  OPENAI_SERVICE_TIER: optionalOverride(
    z.enum(["auto", "default", "flex", "priority", "fast", "ultrafast"]).optional(),
  ),
  // Caps the orchestrator's model steps per turn (default PIPELINE_CONFIG.maxSteps).
  LOTSE_AGENT_MAX_STEPS: optionalOverride(z.coerce.number().int().min(1).max(12).optional()),
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
    baseURL: value.OPENAI_BASE_URL,
    // Compatible endpoints (proxies, gateways) usually cannot resolve stored response items, so
    // they default to stateless requests that carry encrypted reasoning inline.
    responsesStore:
      value.OPENAI_RESPONSES_STORE === undefined
        ? value.OPENAI_BASE_URL
          ? false
          : undefined
        : value.OPENAI_RESPONSES_STORE === "true",
    // Embeddings may live at a different OpenAI-compatible endpoint than chat models.
    embeddingApiKey: value.OPENAI_EMBEDDING_API_KEY ?? value.OPENAI_API_KEY,
    embeddingBaseURL: value.OPENAI_EMBEDDING_BASE_URL ?? value.OPENAI_BASE_URL,
    caseBudgetUsd: value.LOTSE_CASE_BUDGET_USD,
    modelPricing: value.LOTSE_MODEL_PRICING_JSON,
    approvalSecret: value.APPROVAL_HMAC_SECRET,
    allowStubs: false,
    agentMaxSteps: value.LOTSE_AGENT_MAX_STEPS,
    serviceTier: value.OPENAI_SERVICE_TIER,
    reasoningEffort: {
      orchestrator: value.OPENAI_REASONING_EFFORT_ORCHESTRATOR,
      classifier: value.OPENAI_REASONING_EFFORT_CLASSIFIER,
      guard: value.OPENAI_REASONING_EFFORT_GUARD,
      extractor: value.OPENAI_REASONING_EFFORT_EXTRACTOR,
      vision: value.OPENAI_REASONING_EFFORT_VISION,
    } as Partial<Record<ModelRole, ReasoningEffort | undefined>>,
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
      vision: { primary: value.OPENAI_MODEL_VISION, fallback: value.OPENAI_MODEL_VISION_FALLBACK },
      embedding: {
        primary: value.OPENAI_MODEL_EMBEDDING ?? value.EMBEDDING_MODEL ?? "text-embedding-3-small",
        fallback: value.OPENAI_MODEL_EMBEDDING_FALLBACK,
      },
    },
  };
}

export type BrainConfig = ReturnType<typeof parseBrainConfig>;
