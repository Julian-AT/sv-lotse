import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createDatabase, type Database } from "@lotse/db";
import { afterAll, beforeAll, test as corpusTest, expect } from "vitest";
import { loadSozdokEnvironment } from "../../../src/loaders/sozdok/environment.ts";
import { loadSozdok, sozdokChunks } from "../../../src/loaders/sozdok/load.ts";
import { sozdokDirectory } from "../../../src/loaders/sozdok/parse.ts";
import { hasSozdokCorpus } from "./corpus.ts";

loadSozdokEnvironment();
const corpusAvailable = await hasSozdokCorpus();
const test = corpusTest.runIf(corpusAvailable);
let database: Database;
const run = promisify(execFile);
const file = "ABVO_1996=PARA=2=301=1996-06-28=1996-07-01.xml";
let directory: string;
let root: string;
let url: string;
let laterUrl: string;
const testId = `sozdok-test-${randomUUID()}`;

beforeAll(async () => {
  if (!corpusAvailable) return;
  database = createDatabase();
  root = await mkdtemp(join(tmpdir(), "sozdok-"));
  directory = join(root, "Rechtstexte");
  await mkdir(directory);
  const originalXml = await readFile(join(sozdokDirectory(), file), "utf8");
  const originalId = /dokid="([^"]+)"/.exec(originalXml)?.[1];
  if (!originalId) throw new Error("Missing real document ID");
  // Keep real content, but both versions must belong exclusively to this test run.
  const dokid = `${testId}=PARA=2=1996-07-01`;
  const xml = originalXml
    .replaceAll(originalId, dokid)
    .replace(/abkrvo="[^"]*"/, `abkrvo="${testId}"`);
  await writeFile(join(directory, file), xml);
  url = `sozdok://${dokid}`;
  // Create a version history from real text; snapshot contains only one version.
  const laterId = dokid.replace(/1996-07-01$/, "2010-01-01");
  laterUrl = `sozdok://${laterId}`;
  await writeFile(
    join(directory, "later.xml"),
    xml
      .replaceAll(dokid, laterId)
      .replace('ikra="1996-07-01"', 'ikra="2010-01-01"')
      .replace("</absatz>", " Neuer Wortlaut.</absatz>"),
  );
});

afterAll(async () => {
  if (!corpusAvailable) return;
  try {
    if (url) await database.sql`DELETE FROM source WHERE url IN (${url}, ${laterUrl})`;
    if (root) await rm(root, { recursive: true, force: true });
  } finally {
    await database?.close();
  }
});

test("filtered reload closes previously loaded versions and invalidates their chunks", async () => {
  const laterPath = join(directory, "later.xml");
  const laterXml = await readFile(laterPath, "utf8");
  await rm(laterPath);
  try {
    await loadSozdok(database, {
      directory,
      embed: async () => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
    });
    const before = await database.sql<
      { valid_to: string | null }[]
    >`SELECT valid_to FROM source WHERE url = ${url}`;
    expect(before[0]?.valid_to).toBeNull();
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${url})`,
    ).toHaveLength(1);
    await writeFile(laterPath, laterXml);
    expect(await loadSozdok(database, { directory, on: "2010-01-01" })).toEqual({
      sources: 1,
      chunks: 0,
    });
    const after = await database.sql<
      { valid_to: string; metadata: Record<string, unknown> }[]
    >`SELECT valid_to, metadata FROM source WHERE url = ${url}`;
    expect(new Date(after[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
    expect(after[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${url})`,
    ).toHaveLength(0);
    expect(
      await database.sql`SELECT id FROM source WHERE url = ${url}
        AND valid_from <= '2010-01-01'::timestamptz
        AND (valid_to IS NULL OR valid_to > '2010-01-01'::timestamptz)`,
    ).toHaveLength(0);
  } finally {
    await writeFile(laterPath, laterXml);
    await database.sql`DELETE FROM source WHERE url IN (${url}, ${laterUrl})`;
  }
});

test("AC4 CLI loads real-file sources idempotently into Postgres without embeddings", async () => {
  expect([url, laterUrl].every((value) => value.startsWith(`sozdok://${testId}=`))).toBe(true);
  const environment = { ...process.env, SVBOX_DIR: root };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run("bun", ["run", "sozdok:load"], {
      env: environment,
      cwd: new URL("../../../", import.meta.url),
      timeout: 30_000,
    });
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "")).toMatchObject({
      sources: 2,
      chunks: 0,
    });
  }
  const rows = await database.sql<
    {
      id: string;
      url: string;
      text: string;
      valid_from: string;
      valid_to: string | null;
      metadata: Record<string, unknown>;
    }[]
  >`SELECT * FROM source WHERE url IN (${url}, ${laterUrl}) ORDER BY valid_from`;
  expect(rows).toHaveLength(2);
  expect(new Date(rows[0]?.valid_from ?? "").toISOString()).toBe("1996-07-01T00:00:00.000Z");
  expect(new Date(rows[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
  expect(rows[1]?.valid_to).toBeNull();
  expect(rows[0]?.metadata).toMatchObject({ kind: "legal", in_force_to: "2010-01-01" });
  expect(rows[1]?.text).toContain("Neuer Wortlaut.");
  expect(
    await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url IN (${url}, ${laterUrl}))`,
  ).toHaveLength(0);
  const chunks = await sozdokChunks({ directory, on: "2009-12-31" });
  expect(chunks).toHaveLength(1);
  expect(chunks[0]?.url).toBe(url);
  const originalId = rows[0]?.id;
  const sourceXml = await readFile(join(directory, file), "utf8");
  await writeFile(
    join(directory, file),
    sourceXml.replace("</absatz>", " Aktualisierung.</absatz>"),
  );
  await loadSozdok(database, { directory, on: "2000-01-01" });
  const updated = await database.sql<
    { id: string; text: string }[]
  >`SELECT id, text FROM source WHERE url = ${url}`;
  expect(updated).toHaveLength(1);
  expect(updated[0]?.id).toBe(originalId);
  expect(updated[0]?.text).toContain("Aktualisierung.");
}, 60_000);

test("writes kb_chunk only with supplied valid embeddings and keeps reruns idempotent", async () => {
  const embed = async () => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await loadSozdok(database, { directory, embed })).toEqual({ sources: 2, chunks: 2 });
  }
  expect(
    await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url IN (${url}, ${laterUrl}))`,
  ).toHaveLength(2);
  await expect(loadSozdok(database, { directory, embed: async () => [1] })).rejects.toThrow();
  expect(
    await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url IN (${url}, ${laterUrl}))`,
  ).toHaveLength(2);
});

test("date-filtered CLI loads only the version in force and rejects invalid dates", async () => {
  const environment = { ...process.env, SVBOX_DIR: root };
  const result = await run("bun", ["run", "sozdok:load", "--on", "2000-01-01"], {
    env: environment,
    cwd: new URL("../../../", import.meta.url),
    timeout: 30_000,
  });
  expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "")).toEqual({
    sources: 1,
    chunks: 0,
  });
  expect(await sozdokChunks({ directory, on: "1900-01-01" })).toEqual([]);
  await expect(
    run("bun", ["run", "sozdok:load", "--on", "2025-02-30"], {
      env: environment,
      cwd: new URL("../../../", import.meta.url),
    }),
  ).rejects.toMatchObject({ code: 1 });
});

test("concurrent reruns keep one source per version and changed text invalidates stale chunks", async () => {
  await loadSozdok(database, {
    directory,
    // Constructed vector for the chunk invalidation regression, with no provider call.
    embed: async () => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0)),
  });
  await Promise.all([loadSozdok(database, { directory }), loadSozdok(database, { directory })]);
  expect(await database.sql`SELECT id FROM source WHERE url IN (${url}, ${laterUrl})`).toHaveLength(
    2,
  );
  const sourceXml = await readFile(join(directory, file), "utf8");
  await writeFile(
    join(directory, file),
    sourceXml.replace("</absatz>", " Geänderte Fassung.</absatz>"),
  );
  await loadSozdok(database, { directory });
  expect(
    await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${url})`,
  ).toHaveLength(0);
  expect(
    await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${laterUrl})`,
  ).toHaveLength(1);
});

async function withSubset(
  files: string[],
  check: (subset: string) => Promise<void>,
): Promise<void> {
  const subset = await mkdtemp(join(root, "subset-"));
  try {
    for (const name of files) {
      await writeFile(join(subset, name), await readFile(join(directory, name), "utf8"));
    }
    await check(subset);
  } finally {
    await rm(subset, { recursive: true, force: true });
    await database.sql`DELETE FROM source WHERE url IN (${url}, ${laterUrl})`;
  }
}

// Constant vectors in this file exercise real Postgres persistence without an embedding provider.
const regressionEmbed = async () =>
  Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));

test("older-only reload preserves persisted successors and excludes superseded text on later dates", async () => {
  await withSubset([file], async (subset) => {
    await loadSozdok(database, { directory, embed: regressionEmbed });
    expect(await loadSozdok(database, { directory: subset })).toEqual({ sources: 1, chunks: 0 });
    const rows = await database.sql<
      { url: string; valid_to: string | null; metadata: Record<string, unknown> }[]
    >`SELECT url, valid_to, metadata FROM source WHERE url IN (${url}, ${laterUrl}) ORDER BY valid_from`;
    expect(rows).toHaveLength(2);
    expect(new Date(rows[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
    expect(rows[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
    expect(rows[1]?.valid_to).toBeNull();
    expect(await loadSozdok(database, { directory: subset, on: "2015-01-01" })).toEqual({
      sources: 0,
      chunks: 0,
    });
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url IN (${url}, ${laterUrl}))`,
    ).toHaveLength(2);
  });
});

test("newer-only subset closes the persisted predecessor and invalidates its indexed text", async () => {
  await withSubset(["later.xml"], async (subset) => {
    await database.sql`DELETE FROM source WHERE url IN (${url}, ${laterUrl})`;
    const older = await mkdtemp(join(root, "older-"));
    await writeFile(join(older, file), await readFile(join(directory, file), "utf8"));
    await loadSozdok(database, { directory: older, embed: regressionEmbed });
    expect(await loadSozdok(database, { directory: subset })).toEqual({ sources: 1, chunks: 0 });
    const rows = await database.sql<
      { valid_to: string | null; metadata: Record<string, unknown> }[]
    >`SELECT valid_to, metadata FROM source WHERE url IN (${url}, ${laterUrl}) ORDER BY valid_from`;
    expect(rows).toHaveLength(2);
    expect(new Date(rows[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
    expect(rows[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
    expect(rows[1]?.valid_to).toBeNull();
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${url})`,
    ).toHaveLength(0);
  });
});

test("older-only reload preserves a known end when the successor was never inserted", async () => {
  await withSubset([file], async (subset) => {
    await loadSozdok(database, { directory, on: "2000-01-01", embed: regressionEmbed });
    expect(await database.sql`SELECT id FROM source WHERE url = ${laterUrl}`).toHaveLength(0);
    await loadSozdok(database, { directory: subset, embed: regressionEmbed });
    const rows = await database.sql<
      { valid_to: string | null; metadata: Record<string, unknown> }[]
    >`SELECT valid_to, metadata FROM source WHERE url = ${url}`;
    expect(new Date(rows[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
    expect(rows[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
    const chunks = await database.sql<
      { valid_to: string | null; metadata: Record<string, unknown> }[]
    >`SELECT valid_to, metadata FROM kb_chunk WHERE source_id IN
      (SELECT id FROM source WHERE url = ${url})`;
    expect(chunks).toHaveLength(1);
    expect(new Date(chunks[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
    expect(chunks[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
    expect(await loadSozdok(database, { directory: subset, on: "2015-01-01" })).toEqual({
      sources: 0,
      chunks: 0,
    });
  });
});

test("intermediate-only reload retains a successor known only through a persisted end date", async () => {
  await withSubset([file], async (subset) => {
    const intermediateId = `${testId}=PARA=2=2005-01-01`;
    const intermediateUrl = `sozdok://${intermediateId}`;
    try {
      await database.sql`DELETE FROM source WHERE url IN (${url}, ${laterUrl})`;
      await loadSozdok(database, { directory, on: "2000-01-01", embed: regressionEmbed });
      const initial = await database.sql<
        { url: string; metadata: Record<string, unknown> }[]
      >`SELECT url, metadata FROM source WHERE url IN (${url}, ${laterUrl})`;
      expect(initial).toHaveLength(1);
      expect(initial[0]?.url).toBe(url);
      expect(initial[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });

      // The real snapshot has no history; derive an intermediate version from its text.
      const path = join(subset, file);
      const xml = await readFile(path, "utf8");
      await writeFile(
        path,
        xml
          .replaceAll(url.slice("sozdok://".length), intermediateId)
          .replace('ikra="1996-07-01"', 'ikra="2005-01-01"')
          .replace("</absatz>", " Zwischenfassung.</absatz>"),
      );
      expect(await loadSozdok(database, { directory: subset, embed: regressionEmbed })).toEqual({
        sources: 1,
        chunks: 1,
      });
      const rows = await database.sql<
        { url: string; valid_to: string; metadata: Record<string, unknown> }[]
      >`SELECT url, valid_to, metadata FROM source
        WHERE url IN (${url}, ${intermediateUrl}, ${laterUrl}) ORDER BY valid_from`;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.url).toBe(url);
      expect(new Date(rows[0]?.valid_to ?? "").toISOString()).toBe("2005-01-01T00:00:00.000Z");
      expect(rows[0]?.metadata).toMatchObject({ in_force_to: "2005-01-01" });
      expect(rows[1]?.url).toBe(intermediateUrl);
      expect(new Date(rows[1]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
      expect(rows[1]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
      expect(
        await database.sql`SELECT id FROM kb_chunk WHERE source_id IN
          (SELECT id FROM source WHERE url = ${url})`,
      ).toHaveLength(0);
      const chunks = await database.sql<
        { valid_to: string; metadata: Record<string, unknown> }[]
      >`SELECT valid_to, metadata FROM kb_chunk WHERE source_id IN
        (SELECT id FROM source WHERE url = ${intermediateUrl})`;
      expect(chunks).toHaveLength(1);
      expect(new Date(chunks[0]?.valid_to ?? "").toISOString()).toBe("2010-01-01T00:00:00.000Z");
      expect(chunks[0]?.metadata).toMatchObject({ in_force_to: "2010-01-01" });
      expect(
        await database.sql`SELECT id FROM source WHERE url IN (${url}, ${intermediateUrl})
          AND valid_from <= '2010-01-01'::timestamptz
          AND (valid_to IS NULL OR valid_to > '2010-01-01'::timestamptz)`,
      ).toHaveLength(0);
      expect(await loadSozdok(database, { directory: subset, on: "2015-01-01" })).toEqual({
        sources: 0,
        chunks: 0,
      });
    } finally {
      await database.sql`DELETE FROM source WHERE url = ${intermediateUrl}`;
    }
  });
});

test("persists paragraph-specific chunks and invalidates indexes without provision boundaries", async () => {
  const subset = await mkdtemp(join(root, "agreement-"));
  const name = "FamHospKarVertrag_AMS=PARA=1-4==2002-12-09=2003-01-01.xml";
  const xml = await readFile(join(sozdokDirectory(), name), "utf8");
  const originalId = /dokid="([^"]+)"/.exec(xml)?.[1];
  if (!originalId) throw new Error("Missing real agreement document ID");
  const dokid = `${testId}-agreement=PARA=1-4=2003-01-01`;
  const agreementUrl = `sozdok://${dokid}`;
  try {
    // Preserve the real agreement text; isolate both document and provision identities.
    await writeFile(
      join(subset, name),
      xml.replaceAll(originalId, dokid).replace(/abkrvo="[^"]*"/, `abkrvo="${testId}-agreement"`),
    );
    expect(await loadSozdok(database, { directory: subset, embed: regressionEmbed })).toEqual({
      sources: 1,
      chunks: 4,
    });
    const chunks = await database.sql<
      {
        text: string;
        metadata: { paragraph: { gldnr: string }; citation: string; index: number };
      }[]
    >`SELECT text, metadata FROM kb_chunk WHERE source_id IN
      (SELECT id FROM source WHERE url = ${agreementUrl}) ORDER BY (metadata->>'index')::int`;
    expect(chunks.map((chunk) => chunk.metadata.paragraph.gldnr)).toEqual(["1", "2", "3", "4"]);
    for (const chunk of chunks) {
      const number = chunk.metadata.paragraph.gldnr;
      expect([...chunk.text.matchAll(/§\s*(\d+)\./g)].map((match) => match[1])).toEqual([number]);
      expect(chunk.metadata.citation).toBe(
        `§ ${number} ${testId}-agreement (SozDok, in Kraft seit 01.01.2003)`,
      );
    }
    await loadSozdok(database, { directory: subset });
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN
        (SELECT id FROM source WHERE url = ${agreementUrl})`,
    ).toHaveLength(4);
    // Pre-hardening sources carry the same text and file-level citation, but no boundaries.
    await database.sql`UPDATE source SET metadata = metadata - 'provision_ranges'
      WHERE url = ${agreementUrl}`;
    await loadSozdok(database, { directory: subset });
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN
        (SELECT id FROM source WHERE url = ${agreementUrl})`,
    ).toHaveLength(0);
  } finally {
    await database.sql`DELETE FROM source WHERE url = ${agreementUrl}`;
    await rm(subset, { recursive: true, force: true });
  }
});

test("metadata-only correction updates citations and invalidates stale chunk metadata", async () => {
  await withSubset([file], async (subset) => {
    await loadSozdok(database, { directory: subset, embed: regressionEmbed });
    const before = await database.sql<
      { text: string; valid_to: string | null }[]
    >`SELECT text, valid_to FROM source WHERE url = ${url}`;
    expect(before[0]?.valid_to).toBeNull();
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${url})`,
    ).toHaveLength(1);
    const path = join(subset, file);
    const xml = await readFile(path, "utf8");
    await writeFile(path, xml.replace(/abkrvo="[^"]*"/, `abkrvo="${testId} corrected"`));
    await loadSozdok(database, { directory: subset });
    const rows = await database.sql<
      { title: string; text: string; valid_to: string | null; metadata: Record<string, unknown> }[]
    >`SELECT title, text, valid_to, metadata FROM source WHERE url = ${url}`;
    expect(rows[0]?.title).toContain(`${testId} corrected (SozDok`);
    expect(rows[0]?.metadata).toMatchObject({ law_abbr: `${testId} corrected` });
    expect(rows[0]?.text).toBe(before[0]?.text);
    expect(rows[0]?.valid_to).toBeNull();
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN (SELECT id FROM source WHERE url = ${url})`,
    ).toHaveLength(0);
  });
});

test("full-corpus loads and date-filtered reloads fit the default Compose lock budget", async () => {
  const settings = await database.sql<
    { max_locks_per_transaction: string; max_connections: string }[]
  >`SELECT current_setting('max_locks_per_transaction') AS max_locks_per_transaction,
    current_setting('max_connections') AS max_connections`;
  expect(settings[0]).toEqual({ max_locks_per_transaction: "64", max_connections: "100" });
  const corpus = await mkdtemp(join(root, "corpus-"));
  const namespace = `${testId}-corpus-`;
  const prefix = `sozdok://${namespace}`;
  try {
    // Preserve all real text and metadata, namespacing both document and provision identity
    // so this regression cannot update or delete another run's corpus sources.
    const files = (await readdir(sozdokDirectory())).filter((name) => name.endsWith(".xml"));
    expect(files).toHaveLength(14_244);
    for (const name of files) {
      const xml = await readFile(join(sozdokDirectory(), name), "utf8");
      const dokid = /dokid="([^"]+)"/.exec(xml)?.[1];
      if (!dokid) throw new Error(`Missing document ID in ${name}`);
      await writeFile(
        join(corpus, name),
        xml.replaceAll(dokid, `${namespace}${dokid}`).replace(/abkrvo="/, `abkrvo="${namespace}`),
      );
    }
    for (const options of [{ directory: corpus }, { directory: corpus, on: "9999-12-31" }]) {
      expect(await loadSozdok(database, options)).toEqual({ sources: 14_244, chunks: 0 });
    }
    const count = await database.sql<{ count: number }[]>`SELECT count(*)::int AS count
      FROM source WHERE starts_with(url, ${prefix})`;
    expect(count[0]?.count).toBe(14_244);
    expect(
      await database.sql`SELECT id FROM kb_chunk WHERE source_id IN
        (SELECT id FROM source WHERE starts_with(url, ${prefix}))`,
    ).toHaveLength(0);
  } finally {
    await database.sql`DELETE FROM source WHERE starts_with(url, ${prefix})`;
    await rm(corpus, { recursive: true, force: true });
  }
}, 180_000);
