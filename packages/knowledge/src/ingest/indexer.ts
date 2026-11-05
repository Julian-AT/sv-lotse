import type { Database } from "@lotse/db";
import { z } from "zod";
import { INGESTION_CONFIG } from "../config.ts";
import {
  type Embedder,
  type EmbeddingIdentity,
  embeddingIdentitySchema,
  vectorSchema,
} from "./embed.ts";
import type { IngestionDocument } from "./enrich.ts";
import type { Validators } from "./fetcher.ts";
import type { SourceSeed } from "./registry.ts";

export interface StoredFetch {
  raw_html: string;
  validators: Validators;
}
export interface IndexResult {
  status: "indexed" | "unchanged";
  source_id: string;
  chunks: number;
}

export async function indexDocument(
  database: Database,
  document: IngestionDocument,
  embed: Embedder,
  fetched?: StoredFetch,
): Promise<IndexResult> {
  if (document.chunks.length === 0) throw new Error("Cannot index an empty page");
  const identity = embeddingIdentitySchema.parse(embed.identity);
  const embedding = JSON.stringify(identity);
  return database.sql.begin(async (transaction) => {
    // A model switch is a corpus migration, not a per-page content change.
    // One transaction lock keeps cooperating writers from publishing mixed
    // vector spaces. Readers see the old or the new corpus through MVCC.
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended('lotse:knowledge:embedding', 0))`;
    // The source table has no URL uniqueness constraint. Cooperating ingestion
    // writers serialize by URL, including the first insert, without a schema change.
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${document.url}, 0))`;
    const rows = await transaction<
      { id: string; content_hash: string | null; embedding_matches: boolean }[]
    >`
      SELECT id, metadata->>'content_hash' AS content_hash,
        (metadata->'embedding' = ${embedding}::jsonb) IS TRUE AS embedding_matches
      FROM source WHERE url = ${document.url} FOR UPDATE`;
    if (rows.length > 1)
      throw new Error("Source URL is ambiguous; resolve duplicate source records");
    const previous = rows[0];
    const incompatible = await transaction<{ id: string; source_id: string; text: string }[]>`
      SELECT c.id, c.source_id, c.text FROM kb_chunk c JOIN source s ON s.id = c.source_id
      WHERE c.metadata->'embedding' IS DISTINCT FROM ${embedding}::jsonb
         OR s.metadata->'embedding' IS DISTINCT FROM ${embedding}::jsonb
      ORDER BY c.source_id, c.id FOR UPDATE OF c, s`;
    const reusable =
      previous?.content_hash === document.metadata.content_hash &&
      previous.embedding_matches &&
      !incompatible.some((chunk) => chunk.source_id === previous.id);
    const migrating = incompatible.filter((chunk) => chunk.source_id !== previous?.id);
    for (let start = 0; start < migrating.length; start += 32) {
      const batch = migrating.slice(start, start + 32);
      const vectors = z
        .array(vectorSchema)
        .length(batch.length)
        .parse(await embed(batch.map((chunk) => chunk.text)));
      for (const [index, chunk] of batch.entries()) {
        await transaction`UPDATE kb_chunk SET embedding = ${JSON.stringify(vectors[index])}::vector,
          metadata = jsonb_set(metadata, '{embedding}', ${embedding}::jsonb) WHERE id = ${chunk.id}`;
      }
    }
    await transaction`UPDATE source SET metadata = jsonb_set(metadata, '{embedding}', ${embedding}::jsonb)
      WHERE id IS DISTINCT FROM ${previous?.id ?? null}::uuid
        AND EXISTS (SELECT 1 FROM kb_chunk c WHERE c.source_id = source.id)
        AND metadata->'embedding' IS DISTINCT FROM ${embedding}::jsonb`;
    if (reusable && previous) {
      return {
        status: migrating.length ? "indexed" : "unchanged",
        source_id: previous.id,
        chunks: migrating.length,
      };
    }
    const vectors = z
      .array(vectorSchema)
      .length(document.chunks.length)
      .parse(await embed(document.chunks.map((chunk) => chunk.text)));
    // createDatabase's Drizzle adapter installs transparent JSON serializers.
    // Raw tagged SQL must therefore serialize JSON explicitly.
    const metadata = JSON.stringify({
      ...document.metadata,
      ...(fetched ?? {}),
      embedding: identity,
    });
    let sourceId = previous?.id;
    if (sourceId) {
      await transaction`UPDATE source SET title = ${document.metadata.title}, publisher = ${document.publisher},
        text = ${document.text}, metadata = ${metadata}::jsonb, valid_from = ${document.valid_from}, valid_to = ${document.valid_to}
        WHERE id = ${sourceId}`;
      await transaction`DELETE FROM kb_chunk WHERE source_id = ${sourceId}`;
    } else {
      const [inserted] = await transaction<{ id: string }[]>`
        INSERT INTO source (url, title, publisher, text, metadata, valid_from, valid_to)
        VALUES (${document.url}, ${document.metadata.title}, ${document.publisher}, ${document.text},
          ${metadata}::jsonb, ${document.valid_from}, ${document.valid_to}) RETURNING id`;
      if (!inserted) throw new Error("Source insert returned no row");
      sourceId = inserted.id;
    }
    for (const [index, chunk] of document.chunks.entries()) {
      const vector = vectors[index];
      if (!vector) throw new Error("Missing chunk embedding");
      await transaction`INSERT INTO kb_chunk (source_id, text, embedding, metadata, valid_from, valid_to)
        VALUES (${sourceId}, ${chunk.text}, ${JSON.stringify(vector)}::vector,
          ${JSON.stringify({ ...chunk.metadata, embedding: identity, size_exception: chunk.size_exception })}::jsonb, ${chunk.valid_from}, ${chunk.valid_to})`;
    }
    return {
      status: "indexed",
      source_id: sourceId,
      chunks: document.chunks.length + migrating.length,
    };
  });
}

export async function storedValidators(
  database: Database,
  seed: SourceSeed,
  identity: EmbeddingIdentity,
): Promise<Validators> {
  const embedding = JSON.stringify(embeddingIdentitySchema.parse(identity));
  const [row] = await database.sql<
    { publisher: string; metadata: unknown }[]
  >`SELECT publisher, metadata FROM source WHERE url = ${seed.url}`;
  const parsed = z
    .object({
      carrier: z.string().nullable(),
      region: z.string(),
      life_situations: z.array(z.string()),
      embedding: embeddingIdentitySchema,
      pipeline_signature: z.literal(JSON.stringify(INGESTION_CONFIG)),
      validators: z
        .object({
          url: z.url().optional(),
          etag: z.string().optional(),
          last_modified: z.string().optional(),
        })
        .optional(),
    })
    .safeParse(row?.metadata);
  // A 304 must not hide a routing change or required model migration.
  if (
    !parsed.success ||
    row?.publisher !== seed.publisher ||
    parsed.data.carrier !== seed.carrier ||
    parsed.data.region !== seed.region ||
    parsed.data.embedding.model !== identity.model ||
    parsed.data.embedding.dimensions !== identity.dimensions ||
    JSON.stringify(parsed.data.life_situations) !== JSON.stringify(seed.life_situations)
  )
    return {};
  const [incompatible] = await database.sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM kb_chunk c JOIN source s ON s.id = c.source_id
      WHERE c.metadata->'embedding' IS DISTINCT FROM ${embedding}::jsonb
         OR s.metadata->'embedding' IS DISTINCT FROM ${embedding}::jsonb)`;
  if (incompatible?.exists) return {};
  return parsed.data.validators ?? {};
}
