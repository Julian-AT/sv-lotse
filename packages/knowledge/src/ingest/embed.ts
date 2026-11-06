import { createOpenAI } from "@ai-sdk/openai";
import { embeddingDimensions } from "@lotse/db/schema";
import { embedMany } from "ai";
import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const embeddingEnvironment = z.object({
  OPENAI_API_KEY: optional(z.string().min(1)),
  OPENAI_BASE_URL: optional(z.url()),
  OPENAI_EMBEDDING_API_KEY: optional(z.string().min(1)),
  OPENAI_EMBEDDING_BASE_URL: optional(z.url()),
  OPENAI_MODEL_EMBEDDING: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  EMBEDDING_MODEL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
});
export const embeddingIdentitySchema = z.object({
  model: z.string().min(1),
  dimensions: z.literal(embeddingDimensions),
});
export type EmbeddingIdentity = z.infer<typeof embeddingIdentitySchema>;
export interface Embedder {
  (texts: string[]): Promise<number[][]>;
  readonly identity: Readonly<EmbeddingIdentity>;
}
export const vectorSchema = z
  .array(z.number().finite())
  .length(embeddingDimensions)
  .refine((vector) => vector.some((value) => value !== 0), "A cosine-search vector cannot be zero");

// Keep the provider boundary here so retrieval and evaluations can swap models.
// AI SDK retries transient failures (including 429) with exponential backoff.
export function createEmbedder(environment: NodeJS.ProcessEnv = process.env): Embedder {
  const config = embeddingEnvironment.parse(environment);
  const apiKey = config.OPENAI_EMBEDDING_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY or OPENAI_EMBEDDING_API_KEY is required");
  const baseURL = config.OPENAI_EMBEDDING_BASE_URL ?? config.OPENAI_BASE_URL;
  const provider = createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const identity = Object.freeze({
    model: config.OPENAI_MODEL_EMBEDDING ?? config.EMBEDDING_MODEL ?? "text-embedding-3-small",
    dimensions: embeddingDimensions,
  });
  return Object.assign(
    async (texts: string[]) => {
      z.array(z.string().min(1)).parse(texts);
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += 32) {
        const batch = texts.slice(start, start + 32);
        const result = await embedMany({
          model: provider.embeddingModel(identity.model),
          values: batch,
          providerOptions: { openai: { dimensions: embeddingDimensions } },
          maxRetries: 4,
          maxParallelCalls: 1,
          abortSignal: AbortSignal.timeout(60000),
        });
        vectors.push(...z.array(vectorSchema).length(batch.length).parse(result.embeddings));
      }
      return vectors;
    },
    { identity },
  );
}

/**
 * Marks chunks as indexed for full-text search only. The vector column is NOT NULL, so each
 * chunk stores the same unit vector under this identity; retrieval only compares vectors whose
 * identity matches the configured embedding model, so these placeholders never rank results.
 * A later run with a working embedding provider re-embeds them as a normal model migration.
 */
export const LEXICAL_ONLY_MODEL = "lexical-only";
export function createLexicalEmbedder(): Embedder {
  const unit = Array.from({ length: embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0));
  return Object.assign(async (texts: string[]) => texts.map(() => [...unit]), {
    identity: Object.freeze({ model: LEXICAL_ONLY_MODEL, dimensions: embeddingDimensions }),
  });
}

/**
 * Probes the embedding provider once. When it is unreachable (no key, no credits, an endpoint
 * without embeddings), ingestion continues lexical-only instead of failing.
 */
export async function resolveEmbedder(
  environment: NodeJS.ProcessEnv = process.env,
  options: {
    create?: (environment: NodeJS.ProcessEnv) => Embedder;
    warn?: (code: string) => void;
  } = {},
): Promise<Embedder> {
  const warn =
    options.warn ??
    ((code: string) =>
      process.stderr.write(`${JSON.stringify({ event: "embedding_unavailable", code })}\n`));
  if (environment.LOTSE_EMBEDDINGS === "off") {
    warn("EMBEDDINGS_DISABLED");
    return createLexicalEmbedder();
  }
  try {
    const embedder = (options.create ?? createEmbedder)(environment);
    await embedder(["Verfügbarkeitsprüfung"]);
    return embedder;
  } catch (error) {
    const status = z.object({ statusCode: z.number() }).safeParse(error);
    warn(status.success ? `PROVIDER_${status.data.statusCode}` : "PROVIDER_UNAVAILABLE");
    return createLexicalEmbedder();
  }
}
