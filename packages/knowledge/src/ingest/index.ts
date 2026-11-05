export { chunkMarkdown } from "./chunk.ts";
export {
  createEmbedder,
  createLexicalEmbedder,
  type Embedder,
  type EmbeddingIdentity,
  LEXICAL_ONLY_MODEL,
  resolveEmbedder,
} from "./embed.ts";
export { enrich, type IngestionDocument, metadataSchema } from "./enrich.ts";
export { FetchError, type FetchResult, IngestionFetcher } from "./fetcher.ts";
export { indexDocument } from "./indexer.ts";
export { normalizeHtml } from "./normalize.ts";
export { ingestSource } from "./pipeline.ts";
export {
  allowlistSchema,
  loadRegistry,
  type SourceSeed,
  sourceSchema,
  sourcesSchema,
  synonymsSchema,
} from "./registry.ts";
