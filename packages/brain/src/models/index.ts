import { createOpenAI } from "@ai-sdk/openai";
import { type BrainConfig, type ModelRole, parseBrainConfig } from "../config/index.ts";
import { withProviderToolNames } from "./tool-names.ts";

type Language = ReturnType<ReturnType<typeof createOpenAI>["responses"]>;
type Embedding = ReturnType<ReturnType<typeof createOpenAI>["embedding"]>;

// Switch candidates only before a stream is returned. Retrying after a partial
// response could duplicate tool calls or expose inconsistent answers.
export function withLanguageFallback(primary: Language, fallback?: Language): Language {
  if (!fallback) return primary;
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: async (options) => {
      try {
        return await primary.doGenerate(options);
      } catch (error) {
        if (options.abortSignal?.aborted) throw error;
        return fallback.doGenerate(options);
      }
    },
    doStream: async (options) => {
      try {
        return await primary.doStream(options);
      } catch (error) {
        if (options.abortSignal?.aborted) throw error;
        return fallback.doStream(options);
      }
    },
  };
}
export function createModelRouter(config: BrainConfig) {
  const provider = createOpenAI(config.apiKey ? { apiKey: config.apiKey } : {});
  function modelFor(role: "embedding"): Embedding;
  function modelFor(role: Exclude<ModelRole, "embedding">): Language;
  function modelFor(role: ModelRole): Language | Embedding;
  function modelFor(role: ModelRole): Language | Embedding {
    const choice = config.models[role];
    if (role === "embedding") {
      const primary = provider.embedding(choice.primary);
      if (!choice.fallback) return primary;
      const fallback = provider.embedding(choice.fallback);
      return {
        specificationVersion: primary.specificationVersion,
        provider: primary.provider,
        modelId: primary.modelId,
        maxEmbeddingsPerCall: primary.maxEmbeddingsPerCall,
        supportsParallelCalls: primary.supportsParallelCalls,
        doEmbed: async (options) => {
          try {
            return await primary.doEmbed(options);
          } catch (error) {
            if (options.abortSignal?.aborted) throw error;
            return fallback.doEmbed(options);
          }
        },
      };
    }
    return withProviderToolNames(
      withLanguageFallback(
        provider.responses(choice.primary),
        choice.fallback ? provider.responses(choice.fallback) : undefined,
      ),
    );
  }
  return { modelFor };
}
export function modelFor(role: "embedding"): Embedding;
export function modelFor(role: Exclude<ModelRole, "embedding">): Language;
export function modelFor(role: ModelRole): Language | Embedding;
export function modelFor(role: ModelRole): Language | Embedding {
  return createModelRouter(parseBrainConfig()).modelFor(role);
}
