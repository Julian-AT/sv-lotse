import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import {
  type BrainConfig,
  type ModelRole,
  parseBrainConfig,
  type ReasoningEffort,
} from "../config/index.ts";
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
/** Sends reasoning inline instead of referencing response items the endpoint did not store. */
export function withStatelessResponses(model: Language): Language {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => {
        const openai = params.providerOptions?.openai ?? {};
        const include = Array.isArray(openai.include) ? openai.include : [];
        return {
          ...params,
          providerOptions: {
            ...params.providerOptions,
            openai: {
              ...openai,
              store: false,
              include: [...new Set([...include, "reasoning.encrypted_content"])],
            },
          },
        };
      },
    },
  });
}
/** Applies a configured reasoning effort to every call of a role; the operator's choice wins. */
export function withReasoningEffort(model: Language, effort?: ReasoningEffort): Language {
  if (!effort) return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: { ...params.providerOptions?.openai, reasoningEffort: effort },
        },
      }),
    },
  });
}
const RATE_LIMIT_DELAYS_MS = [1_000, 2_000, 4_000];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
/**
 * Shared gateways and local proxies throttle in short windows. Waiting briefly (about 7-10 s in
 * total, jittered) on 429 or a transient 5xx keeps a turn alive instead of failing it; the
 * caller's abort signal still bounds the total time.
 */
export function withRateLimitRetry(
  fetcher: typeof fetch = fetch,
  delays: readonly number[] = RATE_LIMIT_DELAYS_MS,
): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      for (const delay of delays) {
        const response = await fetcher(input, init);
        if (!RETRYABLE_STATUS.has(response.status)) return response;
        await response.body?.cancel();
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : delay + Math.random() * delay * 0.25;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, Math.min(wait, 5_000));
          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(init.signal?.reason);
            },
            { once: true },
          );
        });
      }
      return fetcher(input, init);
    },
    fetcher,
  );
}
function providerSettings(apiKey?: string, baseURL?: string) {
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL, fetch: withRateLimitRetry() } : {}),
  };
}
export function createModelRouter(config: BrainConfig) {
  const provider = createOpenAI(providerSettings(config.apiKey, config.baseURL));
  const embeddingProvider = createOpenAI(
    providerSettings(config.embeddingApiKey, config.embeddingBaseURL),
  );
  function modelFor(role: "embedding"): Embedding;
  function modelFor(role: Exclude<ModelRole, "embedding">): Language;
  function modelFor(role: ModelRole): Language | Embedding;
  function modelFor(role: ModelRole): Language | Embedding {
    const choice = config.models[role];
    if (role === "embedding") {
      const primary = embeddingProvider.embedding(choice.primary);
      if (!choice.fallback) return primary;
      const fallback = embeddingProvider.embedding(choice.fallback);
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
    const effort = config.reasoningEffort?.[role];
    const language = (id: string) =>
      withReasoningEffort(
        config.responsesStore === false
          ? withStatelessResponses(provider.responses(id))
          : provider.responses(id),
        effort,
      );
    return withProviderToolNames(
      withLanguageFallback(
        language(choice.primary),
        choice.fallback ? language(choice.fallback) : undefined,
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
