import type { DatabaseClient } from "@lotse/db";
import { embeddingDimensions, kbChunks, sources } from "@lotse/db/schema";
import { embed } from "ai";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type BrainConfig, PIPELINE_CONFIG } from "../config/index.ts";
import { createModelRouter } from "../models/index.ts";
import { contracts } from "../tools/contracts/index.ts";
import { RetrievalError } from "./errors.ts";
import { expandQuery, fullTextQuery, loadSynonyms, synonymAlternatives } from "./synonyms.ts";

export type SearchInput = z.infer<(typeof contracts)["kb.search"]["input"]>;
export type Passage = z.infer<(typeof contracts)["kb.search"]["output"]>[number];
export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  k: number,
  weights: readonly number[] = [],
): T[] {
  const merged = new Map<string, { item: T; score: number }>();
  for (const [index, list] of lists.entries()) {
    const seen = new Set<string>();
    for (const [rank, item] of list.entries()) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const previous = merged.get(item.id);
      merged.set(item.id, {
        item,
        score:
          (previous?.score ?? 0) + (weights[index] ?? 1) / (PIPELINE_CONFIG.rrfConstant + rank + 1),
      });
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, k)
    .map(({ item }) => item);
}
function metadataFilter(
  key: "carrier" | "region" | "area",
  value?: string,
  groups: string[][] = [],
) {
  if (!value) return undefined;
  const field = sql`coalesce(${kbChunks.metadata}->>${key}, ${sources.metadata}->>${key})`;
  return or(
    sql`${field} IS NULL`,
    inArray(sql`lower(${field})`, synonymAlternatives(value, groups)),
    ...(key === "region" ? [sql`${field} = 'AT'`] : []),
  );
}
let lexicalWarningLogged = false;
// After an embedding failure, skip the provider for a while instead of paying a failed call per turn.
const EMBEDDING_RETRY_MS = 5 * 60_000;
let embeddingRetryAt = 0;
/** Semantic search is optional: without embeddings, retrieval ranks the full-text list alone. */
function warnLexicalOnly(reason: unknown, aborted: boolean): void {
  if (!aborted) embeddingRetryAt = Date.now() + EMBEDDING_RETRY_MS;
  if (lexicalWarningLogged) return;
  lexicalWarningLogged = true;
  const status = z.object({ statusCode: z.number() }).safeParse(reason);
  // Only a status code: provider errors can echo request details.
  console.warn(
    JSON.stringify({
      event: "retrieval_lexical_only",
      code: status.success ? `PROVIDER_${status.data.statusCode}` : "EMBEDDING_UNAVAILABLE",
    }),
  );
}
export function resetLexicalWarning(): void {
  lexicalWarningLogged = false;
  embeddingRetryAt = 0;
}
export async function searchKnowledge(
  db: DatabaseClient,
  config: BrainConfig,
  raw: SearchInput,
  abortSignal?: AbortSignal,
): Promise<Passage[]> {
  const input = contracts["kb.search"].input.parse(raw);
  if (!input.query.trim()) return [];
  const at = input.filters.asOf ? `${input.filters.asOf}T00:00:00Z` : new Date().toISOString();
  const groups = await loadSynonyms();
  const valid = and(
    sql`(${kbChunks.validFrom} IS NULL OR ${kbChunks.validFrom} <= ${at})`,
    sql`(${kbChunks.validTo} IS NULL OR ${kbChunks.validTo} > ${at})`,
    sql`(${sources.validFrom} IS NULL OR ${sources.validFrom} <= ${at})`,
    sql`(${sources.validTo} IS NULL OR ${sources.validTo} > ${at})`,
    metadataFilter("carrier", input.filters.carrier, groups),
    metadataFilter("region", input.filters.region),
    metadataFilter("area", input.filters.area),
  );
  const fields = {
    id: kbChunks.id,
    text: sql<string>`CASE WHEN ${kbChunks.metadata}->>'citation' IS NOT NULL
      THEN (${kbChunks.metadata}->>'citation') || E'\\n' || ${kbChunks.text}
      ELSE ${kbChunks.text} END`,
    url: sources.url,
    validFrom: sql<string>`to_char(coalesce(greatest(${kbChunks.validFrom}, ${sources.validFrom}), ${sources.createdAt}), 'YYYY-MM-DD')`,
    validTo: sql<
      string | null
    >`to_char(least(${kbChunks.validTo}, ${sources.validTo}), 'YYYY-MM-DD')`,
  };
  const expanded = expandQuery(input.query, groups);
  const tsquery = sql`to_tsquery('german', ${fullTextQuery(expanded)})`;
  const lexical = db
    .select(fields)
    .from(kbChunks)
    .innerJoin(sources, eq(kbChunks.sourceId, sources.id))
    .where(and(valid, sql`${kbChunks.tsv} @@ ${tsquery}`))
    .orderBy(desc(sql`ts_rank_cd(${kbChunks.tsv}, ${tsquery})`), asc(kbChunks.id))
    .limit(PIPELINE_CONFIG.candidateLimit);
  // Avoid a paid embedding request when the corpus is empty.
  const [present] = await db.select({ id: kbChunks.id }).from(kbChunks).limit(1);
  if (!present) return [];
  const semantic = async (): Promise<Passage[]> => {
    if (Date.now() < embeddingRetryAt) return [];
    const result = await embed({
      model: createModelRouter(config).modelFor("embedding"),
      // Multilingual embeddings understand the original question. Lexical aliases
      // improve term matching but dilute the semantic intent when appended here.
      value: input.query,
      providerOptions: { openai: { dimensions: embeddingDimensions } },
      maxRetries: 1,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(PIPELINE_CONFIG.classifierTimeoutMs),
        ...(abortSignal ? [abortSignal] : []),
      ]),
      telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false },
    });
    const vector = z.array(z.number().finite()).length(embeddingDimensions).parse(result.embedding);
    const responseModel = z.object({ model: z.string().min(1) }).safeParse(result.response?.body);
    // A fallback may belong to a different vector space. Unknown identity is lexical-only.
    if (config.models.embedding.fallback && !responseModel.success) return [];
    const identity = responseModel.success
      ? responseModel.data.model
      : config.models.embedding.primary;
    return db
      .select(fields)
      .from(kbChunks)
      .innerJoin(sources, eq(kbChunks.sourceId, sources.id))
      .where(
        and(
          valid,
          sql`${kbChunks.metadata}->'embedding'->>'model' = ${identity}`,
          sql`${kbChunks.metadata}->'embedding'->>'dimensions' = ${String(embeddingDimensions)}`,
        ),
      )
      .orderBy(
        asc(sql`${kbChunks.embedding} <=> ${JSON.stringify(vector)}::vector`),
        asc(kbChunks.id),
      )
      .limit(PIPELINE_CONFIG.candidateLimit);
  };
  const [textResult, vectorResult] = await Promise.allSettled([lexical, semantic()]);
  if (textResult.status === "rejected") {
    const failure = z
      .object({
        cause: z
          .object({
            code: z
              .string()
              .regex(/^[A-Z0-9]{5}$/)
              .optional(),
          })
          .optional(),
      })
      .safeParse(textResult.reason);
    throw new RetrievalError(
      "KNOWLEDGE_SEARCH_FAILED",
      failure.success ? failure.data.cause?.code : undefined,
    );
  }
  if (abortSignal?.aborted) throw new RetrievalError("TURN_ABORTED");
  if (vectorResult.status === "rejected")
    warnLexicalOnly(vectorResult.reason, abortSignal?.aborted ?? false);
  const fused = reciprocalRankFusion(
    [textResult.value, vectorResult.status === "fulfilled" ? vectorResult.value : []],
    input.k,
    PIPELINE_CONFIG.retrievalWeights,
  );
  return contracts["kb.search"].output.parse(fused);
}
