import { createDatabase } from "@lotse/db";
import { expect, test } from "vitest";
import { createEmbedder } from "../../src/ingest/embed.ts";
import { loadEnvironment } from "../../src/ingest/environment.ts";
import { IngestionFetcher } from "../../src/ingest/fetcher.ts";
import { ingestSource } from "../../src/ingest/pipeline.ts";
import { loadRegistry } from "../../src/ingest/registry.ts";

loadEnvironment();
test("AC4 one real allowlisted page with real OpenAI embeddings is found by German full-text and vector search", async () => {
  if (process.env.RUN_LIVE !== "1") throw new Error("Live acceptance requires RUN_LIVE=1");
  const registry = await loadRegistry();
  const seed = registry.sources.find((source) => new URL(source.url).hostname === "www.oegk.at");
  if (!seed) throw new Error("Missing official live source");
  const database = createDatabase();
  try {
    const embed = createEmbedder();
    const embedding = JSON.stringify(embed.identity);
    const fetcher = new IngestionFetcher(registry.allowlist.origins.map((entry) => entry.origin));
    const result = await ingestSource(database, fetcher, seed, embed);
    expect(["indexed", "unchanged", "not_modified"]).toContain(result.status);
    const sentence =
      "Finden Sie Kundenservicestellen und Gesundheitseinrichtungen der ÖGK in Ihrer Nähe:";
    const fullText = await database.sql<{ text: string }[]>`
      SELECT c.text FROM kb_chunk c JOIN source s ON s.id = c.source_id
      WHERE s.url = ${seed.url} AND c.metadata->'embedding' = ${embedding}::jsonb
        AND c.tsv @@ plainto_tsquery('german', ${sentence})`;
    expect(fullText.some((row) => row.text.includes(sentence))).toBe(true);
    const vectors = await embed([sentence]);
    const vector = vectors[0];
    if (!vector) throw new Error("Missing query embedding");
    expect(vector).toHaveLength(1536);
    const nearest = await database.sql<{ text: string; distance: number }[]>`
      SELECT c.text, c.embedding <=> ${JSON.stringify(vector)}::vector AS distance
      FROM kb_chunk c JOIN source s ON s.id = c.source_id WHERE s.url = ${seed.url}
        AND c.metadata->'embedding' = ${embedding}::jsonb
      ORDER BY c.embedding <=> ${JSON.stringify(vector)}::vector LIMIT 1`;
    expect(nearest[0]?.text).toContain(sentence);
    expect(Number(nearest[0]?.distance)).toBeLessThan(0.6);
  } finally {
    await database.close();
  }
}, 120000);
