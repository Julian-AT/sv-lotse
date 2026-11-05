import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createDatabase } from "@lotse/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { enrich } from "../../src/ingest/enrich.ts";
import { loadEnvironment } from "../../src/ingest/environment.ts";
import { IngestionFetcher } from "../../src/ingest/fetcher.ts";
import { indexDocument, storedValidators } from "../../src/ingest/indexer.ts";
import { normalizeHtml } from "../../src/ingest/normalize.ts";
import { ingestSource } from "../../src/ingest/pipeline.ts";

loadEnvironment();
// A model migration affects the whole index. Keep these real Postgres tables
// isolated from other suites and live ingestion, using the migrated schema.
const administration = createDatabase();
const schema = `ingestion_${randomUUID().replaceAll("-", "")}`;
const connection = new URL(administration.config.DATABASE_URL);
connection.searchParams.set("options", `-c search_path=${schema},public`);
const database = createDatabase({ ...process.env, DATABASE_URL: connection.href });
beforeAll(async () => {
  await administration.sql`CREATE SCHEMA ${administration.sql(schema)}`;
  await administration.sql`CREATE TABLE ${administration.sql(schema)}.source (LIKE public.source INCLUDING ALL)`;
  await administration.sql`CREATE TABLE ${administration.sql(schema)}.kb_chunk (LIKE public.kb_chunk INCLUDING ALL)`;
  await administration.sql`ALTER TABLE ${administration.sql(schema)}.kb_chunk
    ADD FOREIGN KEY (source_id) REFERENCES ${administration.sql(schema)}.source(id) ON DELETE CASCADE`;
});
const url = `https://www.oegk.at/test-ingestion/${randomUUID()}`;
const html = readFileSync(new URL("./fixtures/oegk-contact.html.txt", import.meta.url), "utf8");
const seed = {
  url,
  publisher: "ÖGK",
  refresh_days: 7,
  carrier: "ÖGK",
  region: "AT",
  life_situations: ["administration"],
};
const original = enrich(normalizeHtml(html, url), seed, new Date().toISOString());
let calls = 0;
// Deterministic embeddings are confined to this database test. Production and
// the live acceptance test use OpenAI; this test isolates transaction semantics.
const identity = { model: "test-embedding-v1", dimensions: 1536 as const };
const embed = Object.assign(
  async (texts: string[]) => {
    calls++;
    return texts.map((text) =>
      Array.from({ length: 1536 }, (_, index) =>
        index === 0 ? 1 : index === 1 ? text.length / 100000 : 0,
      ),
    );
  },
  { identity },
);
afterAll(async () => {
  try {
    await database.close();
    await administration.sql`DROP SCHEMA ${administration.sql(schema)} CASCADE`;
  } finally {
    await administration.close();
  }
});

test("AC3 real Postgres inserts, performs no writes for unchanged content and replaces changed chunks atomically", async () => {
  const first = await indexDocument(database, original, embed, {
    raw_html: html,
    validators: { etag: '"v1"', url },
  });
  expect(first.status).toBe("indexed");
  const sources = await database.sql`SELECT * FROM source WHERE url = ${url}`;
  expect(sources).toHaveLength(1);
  const before =
    await database.sql`SELECT * FROM kb_chunk WHERE source_id = ${first.source_id} ORDER BY id`;
  expect(before).toHaveLength(original.chunks.length);
  expect(before[0]?.metadata).toMatchObject({ carrier: "ÖGK", region: "AT" });
  expect(await storedValidators(database, seed, identity)).toEqual({ etag: '"v1"', url });
  expect(await storedValidators(database, { ...seed, region: "Wien" }, identity)).toEqual({});
  await database.sql`UPDATE source SET metadata = metadata - 'pipeline_signature' WHERE url = ${url}`;
  expect(await storedValidators(database, seed, identity)).toEqual({});
  await database.sql`UPDATE source SET metadata = jsonb_set(metadata, '{pipeline_signature}',
    ${JSON.stringify(original.metadata.pipeline_signature)}::jsonb) WHERE url = ${url}`;
  expect(await storedValidators(database, seed, identity)).toEqual({ etag: '"v1"', url });
  const xmin = await database.sql`SELECT xmin::text FROM source WHERE url = ${url}`;
  expect((await indexDocument(database, original, embed)).status).toBe("unchanged");
  expect(calls).toBe(1);
  expect(await database.sql`SELECT xmin::text FROM source WHERE url = ${url}`).toEqual(xmin);
  expect(
    await database.sql`SELECT * FROM kb_chunk WHERE source_id = ${first.source_id} ORDER BY id`,
  ).toEqual(before);

  const changed = enrich(
    normalizeHtml(`${html.replaceAll("Standortsuche", "Standorte und Kontakte")}`, url),
    seed,
    new Date().toISOString(),
  );
  const result = await indexDocument(database, changed, embed);
  expect(result.source_id).toBe(first.source_id);
  const after =
    await database.sql`SELECT * FROM kb_chunk WHERE source_id = ${first.source_id} ORDER BY id`;
  expect(after).toHaveLength(changed.chunks.length);
  expect(after.map((row) => row.id)).not.toEqual(before.map((row) => row.id));
  expect((await database.sql`SELECT text FROM source WHERE url = ${url}`)[0]?.text).toBe(
    changed.text,
  );

  const failure = Object.assign(
    async () => {
      throw new Error("Embedding service unavailable");
    },
    { identity },
  );
  await expect(indexDocument(database, original, failure)).rejects.toThrow(
    "Embedding service unavailable",
  );
  expect(
    await database.sql`SELECT * FROM kb_chunk WHERE source_id = ${first.source_id} ORDER BY id`,
  ).toEqual(after);
  await expect(
    indexDocument(
      database,
      original,
      Object.assign(async () => [[0]], { identity }),
    ),
  ).rejects.toThrow();
  expect(
    await database.sql`SELECT * FROM kb_chunk WHERE source_id = ${first.source_id} ORDER BY id`,
  ).toEqual(after);

  // PostgreSQL rejects a NUL byte in text. Inject it only into a chunk to force
  // an INSERT failure after the source UPDATE and chunk DELETE have executed.
  const invalid = {
    ...original,
    chunks: original.chunks.map((chunk) => ({ ...chunk, text: `${chunk.text}\0` })),
  };
  await expect(indexDocument(database, invalid, embed)).rejects.toMatchObject({ code: "22021" });
  expect(
    await database.sql`SELECT * FROM kb_chunk WHERE source_id = ${first.source_id} ORDER BY id`,
  ).toEqual(after);
  expect((await database.sql`SELECT text FROM source WHERE url = ${url}`)[0]?.text).toBe(
    changed.text,
  );
});

test("model changes bypass 304 and atomically re-embed the entire index without mixing vector spaces", async () => {
  const headers: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.end("User-agent: *\nDisallow:\n");
      return;
    }
    headers.push(request.headers["if-none-match"]);
    if (request.headers["if-none-match"]) response.writeHead(304).end();
    else response.writeHead(200, { "content-type": "text/html", etag: '"stable"' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const origin = `http://127.0.0.1:${address.port}`;
    const localSeed = { ...seed, url: `${origin}/model` };
    const peerSeed = { ...seed, url: `${origin}/peer` };
    const peer = enrich(normalizeHtml(html, peerSeed.url), peerSeed, new Date().toISOString());
    await indexDocument(database, peer, embed);
    const fetcher = new IngestionFetcher([origin], { delayMs: 1 });
    expect((await ingestSource(database, fetcher, localSeed, embed)).status).toBe("indexed");
    expect((await ingestSource(database, fetcher, localSeed, embed)).status).toBe("not_modified");
    expect(headers).toEqual([undefined, '"stable"']);

    const nextIdentity = { ...identity, model: "test-embedding-v2" };
    let migrated = 0;
    const nextVector = Array.from({ length: 1536 }, (_, index) => (index === 1 ? 1 : 0));
    const nextEmbed = Object.assign(
      async (texts: string[]) => {
        migrated += texts.length;
        return texts.map(() => [...nextVector]);
      },
      { identity: nextIdentity },
    );
    const before = await database.sql`SELECT id, embedding, metadata FROM kb_chunk ORDER BY id`;
    const sourceBefore = await database.sql`SELECT id, metadata FROM source ORDER BY id`;
    expect(await storedValidators(database, localSeed, nextIdentity)).toEqual({});

    // Fail after one batch has been migrated, proving rollback across sources.
    let attempts = 0;
    const failure = Object.assign(
      async (texts: string[]) => {
        if (++attempts > 1) {
          // A separate reader still sees one old vector space mid-migration.
          expect(
            await database.sql`SELECT id, embedding, metadata FROM kb_chunk ORDER BY id`,
          ).toEqual(before);
          throw new Error("Migration failed");
        }
        return nextEmbed(texts);
      },
      { identity: nextIdentity },
    );
    await expect(ingestSource(database, fetcher, localSeed, failure)).rejects.toThrow(
      "Migration failed",
    );
    expect(await database.sql`SELECT id, embedding, metadata FROM kb_chunk ORDER BY id`).toEqual(
      before,
    );
    expect(await database.sql`SELECT id, metadata FROM source ORDER BY id`).toEqual(sourceBefore);
    migrated = 0;
    expect((await ingestSource(database, fetcher, localSeed, nextEmbed)).status).toBe("indexed");
    expect(headers.slice(2)).toEqual([undefined, undefined]);
    expect(migrated).toBe(before.length);
    const after = await database.sql`SELECT embedding, metadata FROM kb_chunk`;
    expect(after).toHaveLength(before.length);
    for (const row of after) {
      expect(row.metadata.embedding).toEqual(nextIdentity);
      expect(JSON.parse(row.embedding)).toEqual(nextVector);
    }
    for (const row of await database.sql`SELECT metadata FROM source`) {
      expect(row.metadata.embedding).toEqual(nextIdentity);
    }
    expect((await ingestSource(database, fetcher, localSeed, nextEmbed)).status).toBe(
      "not_modified",
    );
    expect(headers.at(-1)).toBe('"stable"');

    // Incorrect dimensions and missing legacy chunk identities each need repair.
    await database.sql`UPDATE source SET metadata = jsonb_set(metadata, '{embedding,dimensions}', '768') WHERE url = ${localSeed.url}`;
    expect(await storedValidators(database, localSeed, nextIdentity)).toEqual({});
    const callsBefore = migrated;
    expect((await ingestSource(database, fetcher, localSeed, nextEmbed)).status).toBe("indexed");
    expect(migrated - callsBefore).toBe(original.chunks.length);
    expect(await storedValidators(database, localSeed, nextIdentity)).toEqual({
      etag: '"stable"',
      url: localSeed.url,
    });
    await database.sql`UPDATE kb_chunk SET metadata = metadata - 'embedding' WHERE source_id = (SELECT id FROM source WHERE url = ${localSeed.url})`;
    expect(await storedValidators(database, localSeed, nextIdentity)).toEqual({});
    expect((await ingestSource(database, fetcher, localSeed, nextEmbed)).status).toBe("indexed");
    // Even a compatible page's 304 must not hide incompatible peer vectors.
    await database.sql`UPDATE kb_chunk SET metadata = metadata - 'embedding' WHERE source_id = (SELECT id FROM source WHERE url = ${peerSeed.url})`;
    expect(await storedValidators(database, localSeed, nextIdentity)).toEqual({});
    const repaired = await ingestSource(database, fetcher, localSeed, nextEmbed);
    expect(repaired).toMatchObject({ status: "indexed", chunks: peer.chunks.length });
    expect(await storedValidators(database, localSeed, nextIdentity)).toEqual({
      etag: '"stable"',
      url: localSeed.url,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("concurrent ingestion of the same URL creates one source and one chunk set", async () => {
  const changed = { ...original, metadata: { ...original.metadata, content_hash: "f".repeat(64) } };
  const results = await Promise.all([
    indexDocument(database, changed, embed),
    indexDocument(database, changed, embed),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(["indexed", "unchanged"]);
  expect(await database.sql`SELECT id FROM source WHERE url = ${url}`).toHaveLength(1);
  expect(
    await database.sql`SELECT id FROM kb_chunk WHERE source_id = ${results[0]?.source_id}`,
  ).toHaveLength(original.chunks.length);
});

// Constructed seasonal sections add validity cases absent from the saved contact page.
test("date filtering excludes expired seasonal chunks and retains unrelated contact chunks", async () => {
  const localSeed = { ...seed, url: `${url}/seasonal` };
  const document = enrich(
    normalizeHtml(
      "<main><h1>Information</h1><section><h2>Saisonangebot</h2><p>Gültig ab: 01.06.2025</p><p>Gültig bis: 31.08.2025</p><p>Saisonale Information</p></section><section><h2>Kontakt</h2><p>Kontaktstelle in Wien</p></section></main>",
      localSeed.url,
    ),
    localSeed,
    "2026-11-05T12:00:00.000Z",
  );
  const result = await indexDocument(database, document, embed);
  const chunks = await database.sql<
    { text: string; valid_from: string | null; valid_to: string | null }[]
  >`SELECT text, valid_from, valid_to FROM kb_chunk WHERE source_id = ${result.source_id} ORDER BY text`;
  expect(chunks).toHaveLength(2);
  const seasonal = chunks.find((chunk) => chunk.text.includes("Saisonangebot"));
  expect(seasonal?.valid_from && new Date(seasonal.valid_from).toISOString()).toBe(
    "2025-06-01T00:00:00.000Z",
  );
  expect(seasonal?.valid_to && new Date(seasonal.valid_to).toISOString()).toBe(
    "2025-08-31T00:00:00.000Z",
  );
  expect(chunks.find((chunk) => chunk.text.includes("Kontaktstelle"))).toMatchObject({
    valid_from: null,
    valid_to: null,
  });
  const asOf = "2026-11-05T12:00:00.000Z";
  const active = await database.sql`SELECT text FROM kb_chunk WHERE source_id = ${result.source_id}
    AND (valid_from IS NULL OR valid_from <= ${asOf}::timestamptz)
    AND (valid_to IS NULL OR valid_to > ${asOf}::timestamptz)`;
  expect(active).toHaveLength(1);
  expect(active[0]?.text).toContain("Kontaktstelle in Wien");
});

test("caption-only changes replace indexed eligibility context and content hash", async () => {
  const localSeed = { ...seed, url: `${url}/caption` };
  // The saved official page has no captioned payment table; this constructed
  // administrative case exercises the qualification from the review finding.
  const markup =
    "<main><h1>Information</h1><table><caption>Nur für Versicherte ab 18 Jahren</caption><tr><th>Betrag</th></tr><tr><td>20 EUR</td></tr></table></main>";
  const makeDocument = (html: string) =>
    enrich(normalizeHtml(html, localSeed.url), localSeed, "2026-11-05T12:00:00.000Z");
  const original = makeDocument(markup);
  const first = await indexDocument(database, original, embed);
  const before = await database.sql`SELECT text FROM kb_chunk WHERE source_id = ${first.source_id}`;
  expect(before).toHaveLength(1);
  expect(before[0]?.text).toContain("Nur für Versicherte ab 18 Jahren");
  expect(before[0]?.text).toContain("20 EUR");
  const changed = makeDocument(markup.replace("18 Jahren", "21 Jahren"));
  expect(changed.metadata.content_hash).not.toBe(original.metadata.content_hash);
  const result = await indexDocument(database, changed, embed);
  expect(result).toMatchObject({ status: "indexed", source_id: first.source_id, chunks: 1 });
  const after = await database.sql`SELECT text FROM kb_chunk WHERE source_id = ${first.source_id}`;
  expect(after).toHaveLength(1);
  expect(after[0]?.text).toContain("Nur für Versicherte ab 21 Jahren");
  expect(after[0]?.text).toContain("20 EUR");
  expect(after[0]?.text).not.toContain("18 Jahren");
  const [stored] =
    await database.sql`SELECT metadata->>'content_hash' AS hash FROM source WHERE id = ${first.source_id}`;
  expect(stored?.hash).toBe(changed.metadata.content_hash);
});
