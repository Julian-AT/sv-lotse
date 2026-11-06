import { randomUUID } from "node:crypto";
import { embeddingDimensions, kbChunks, sources } from "@lotse/db/schema";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetLexicalWarning, searchKnowledge } from "../../src/retrieval/index.ts";
import { config, isolatedDatabase } from "../runtime/helpers.ts";

// Only the paid provider boundary is doubled. SQL, German stemming, vectors and filters run in real Postgres.
const { embedQuery } = vi.hoisted(() => ({ embedQuery: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  embed: embedQuery,
}));
describe("hybrid retrieval against real Postgres", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  const currentId = randomUUID();
  const oldModelId = randomUUID();
  const futureId = randomUUID();
  const vector = Array.from({ length: embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0));
  beforeAll(async () => {
    database = await isolatedDatabase();
    embedQuery.mockResolvedValue({ embedding: vector });
    // Verbatim official passage; the extra validity/routing rows below construct cases not present in the source.
    const text =
      "Maßnahmen der medizinischen Rehabilitation werden nur aufgrund eines Antrages erbracht.";
    for (const fixture of [
      {
        id: currentId,
        carrier: null,
        region: "AT",
        from: null,
        to: null,
        sourceTo: null,
        model: config.models.embedding.primary,
      },
      {
        id: randomUUID(),
        carrier: null,
        region: "AT",
        from: null,
        to: new Date("2026-01-01Z"),
        sourceTo: null,
        model: config.models.embedding.primary,
      },
      {
        id: futureId,
        carrier: null,
        region: "AT",
        from: new Date("2030-01-01Z"),
        to: null,
        sourceTo: null,
        model: config.models.embedding.primary,
      },
      {
        id: randomUUID(),
        carrier: null,
        region: "AT",
        from: null,
        to: null,
        sourceTo: new Date("2026-01-01Z"),
        model: config.models.embedding.primary,
      },
      {
        id: randomUUID(),
        carrier: "SVS",
        region: "AT",
        from: null,
        to: null,
        sourceTo: null,
        model: config.models.embedding.primary,
      },
      {
        id: randomUUID(),
        carrier: "ÖGK",
        region: "Tirol",
        from: null,
        to: null,
        sourceTo: null,
        model: config.models.embedding.primary,
      },
      {
        id: oldModelId,
        carrier: "ÖGK",
        region: "AT",
        from: null,
        to: null,
        sourceTo: null,
        model: "different-vector-space",
      },
    ]) {
      const sourceId = randomUUID();
      await database.db.insert(sources).values({
        id: sourceId,
        url: "https://www.gesundheit.gv.at/gesundheitsleistungen/kur-reha/medizinische-rehabilitation.html",
        title: "Medizinische Rehabilitation",
        publisher: "Gesundheitsportal Österreich",
        validTo: fixture.sourceTo,
        metadata: { carrier: fixture.carrier, region: fixture.region },
      });
      await database.db.insert(kbChunks).values({
        id: fixture.id,
        sourceId,
        text,
        embedding: vector,
        validFrom: fixture.from,
        validTo: fixture.to,
        metadata: { embedding: { model: fixture.model, dimensions: embeddingDimensions } },
      });
    }
  });
  afterAll(async () => {
    await database?.cleanup();
  });
  it("filters both source and chunk validity, resolves carrier aliases and keeps nationwide passages", async () => {
    const result = await searchKnowledge(database.db, config, {
      query: "Rehabilitation Antrag",
      filters: { carrier: "oegk", region: "Wien", asOf: "2026-11-06" },
      k: 10,
    });
    expect(result.map((passage) => passage.id).sort()).toEqual([currentId, oldModelId].sort());
    expect(new Set(result.map((passage) => passage.id)).size).toBe(result.length);
  });
  it("retrieves semantic matches but excludes a different embedding model", async () => {
    const result = await searchKnowledge(database.db, config, {
      query: "unrelatedsemanticquery",
      filters: { carrier: "oegk", region: "Wien", asOf: "2026-11-06" },
      k: 1,
    });
    expect(result.map((passage) => passage.id)).toEqual([currentId]);
  });
  it("uses inclusive validity starts and exclusive ends without admitting expired sources", async () => {
    const search = (asOf: string) =>
      searchKnowledge(database.db, config, {
        query: "unrelatedsemanticquery",
        filters: { carrier: "oegk", region: "Wien", asOf },
        k: 10,
      });
    expect((await search("2026-01-01")).map(({ id }) => id)).toEqual([currentId]);
    expect((await search("2030-01-01")).map(({ id }) => id).sort()).toEqual(
      [currentId, futureId].sort(),
    );
  });
  it("continues with German full-text when the embedding service is unavailable", async () => {
    resetLexicalWarning();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    embedQuery.mockRejectedValueOnce(Object.assign(new Error("secret body"), { statusCode: 404 }));
    embedQuery.mockRejectedValueOnce(new Error("Provider unavailable"));
    const calls = embedQuery.mock.calls.length;
    const search = () =>
      searchKnowledge(database.db, config, {
        query: "Rehabilitation Antrag",
        filters: { carrier: "oegk", region: "Wien", asOf: "2026-11-06" },
        k: 10,
      });
    expect((await search()).map((passage) => passage.id).sort()).toEqual(
      [currentId, oldModelId].sort(),
    );
    expect((await search()).map((passage) => passage.id).sort()).toEqual(
      [currentId, oldModelId].sort(),
    );
    // One warning per process, carrying only the status code; the provider is then skipped.
    expect(embedQuery).toHaveBeenCalledTimes(calls + 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("PROVIDER_404");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret");
    warn.mockRestore();
    resetLexicalWarning();
    embedQuery.mockReset();
    embedQuery.mockResolvedValue({ embedding: vector });
  });
  it("does not compare fallback vectors when the provider cannot establish their model identity", async () => {
    const fallbackConfig = {
      ...config,
      models: {
        ...config.models,
        embedding: { primary: config.models.embedding.primary, fallback: "another-vector-space" },
      },
    };
    const result = await searchKnowledge(database.db, fallbackConfig, {
      query: "unrelatedsemanticquery",
      filters: { carrier: "oegk", region: "Wien", asOf: "2026-11-06" },
      k: 5,
    });
    expect(result).toEqual([]);
  });
});
