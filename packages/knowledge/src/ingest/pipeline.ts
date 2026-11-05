import type { Database } from "@lotse/db";
import type { Embedder } from "./embed.ts";
import { enrich } from "./enrich.ts";
import type { IngestionFetcher } from "./fetcher.ts";
import { indexDocument, storedValidators } from "./indexer.ts";
import { normalizeHtml } from "./normalize.ts";
import type { SourceSeed } from "./registry.ts";

export async function ingestSource(
  database: Database | null,
  fetcher: IngestionFetcher,
  seed: SourceSeed,
  embed: Embedder | null,
) {
  if (database && !embed) throw new Error("An embedding provider is required for indexing");
  const previous = database && embed ? await storedValidators(database, seed, embed.identity) : {};
  const fetched = await fetcher.fetch(seed.url, previous);
  if (fetched.status !== "fetched") return fetched;
  const page = normalizeHtml(fetched.html, fetched.url, { searchable: true });
  const document = enrich(page, { ...seed, url: fetched.url }, fetched.retrieved_at);
  // Identity remains the registered URL even when the site canonicalizes it.
  document.url = seed.url;
  if (!database)
    return {
      status: "dry_run" as const,
      chunks: document.chunks.length,
      content_hash: document.metadata.content_hash,
    };
  if (!embed) throw new Error("An embedding provider is required for indexing");
  return indexDocument(database, document, embed, {
    raw_html: fetched.html,
    validators: fetched.validators,
  });
}
