import { createOpenAI } from "@ai-sdk/openai";
import { embeddingDimensions } from "@lotse/brain/db/schema";
import { embedMany } from "ai";
import { z } from "zod";

const embeddingEnvironment = z.object({
  OPENAI_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-large"),
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
  const provider = createOpenAI({ apiKey: config.OPENAI_API_KEY });
  const identity = Object.freeze({
    model: config.EMBEDDING_MODEL,
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
