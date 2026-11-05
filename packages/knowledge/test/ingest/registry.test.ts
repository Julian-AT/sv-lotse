import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { allowlistSchema, loadRegistry } from "../../src/ingest/registry.ts";
import { loadKnowledge } from "../../src/loader/index.ts";
import { AllowlistSchema } from "../../src/schemas/common.ts";

const root = new URL("../../", import.meta.url);

test("ingestion and the shared knowledge loader accept the same allowlist with provenance", async () => {
  const raw: unknown = parse(await readFile(new URL("allowlist.yaml", root), "utf8"));
  const shared = AllowlistSchema.parse(raw);
  const registry = await loadRegistry();
  expect(registry.allowlist).toEqual(shared);
  expect((await loadKnowledge(fileURLToPath(root))).allowlist).toEqual(shared);
  expect(shared.verified_at).toBeDefined();
});

test("ingestion uses the current Pensionsversicherung origin in seeds and provenance", async () => {
  const registry = await loadRegistry();
  const origin = "https://www.pv.at";
  expect(registry.allowlist.origins.map((entry) => entry.origin)).toContain(origin);
  expect(registry.sources.some((entry) => new URL(entry.url).origin === origin)).toBe(true);
  expect(registry.allowlist.sources.some((entry) => new URL(entry.url).origin === origin)).toBe(
    true,
  );
  const urls = [
    ...registry.allowlist.origins.map((entry) => entry.origin),
    ...registry.allowlist.sources.map((entry) => entry.url),
    ...registry.sources.map((entry) => entry.url),
  ];
  expect(urls.some((url) => new URL(url).hostname === "www.pva.at")).toBe(false);
});

test("ingestion reads ingest-sources.yaml independently of the shared sources.yaml registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ingest-registry-"));
  const target = pathToFileURL(`${directory}/`);
  try {
    for (const name of ["allowlist.yaml", "ingest-sources.yaml", "synonyms.yaml"]) {
      await writeFile(new URL(name, target), await readFile(new URL(name, root)));
    }
    const registry = await loadRegistry(target);
    await writeFile(
      new URL("sources.yaml", target),
      stringify({ sources: registry.allowlist.sources, as_of: registry.allowlist.as_of }),
    );
    expect(await loadRegistry(target)).toEqual(registry);

    const seed = registry.sources[0];
    if (!seed) throw new Error("Missing source seed");
    await writeFile(
      new URL("ingest-sources.yaml", target),
      stringify([{ ...seed, url: "https://unlisted.example.org/" }]),
    );
    await expect(loadRegistry(target)).rejects.toThrow("unlisted origin");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ingestion rejects duplicate origins and origins with paths or credentials", async () => {
  const registry = await loadRegistry();
  expect(
    allowlistSchema.safeParse({
      ...registry.allowlist,
      origins: [...registry.allowlist.origins, ...registry.allowlist.origins],
    }).success,
  ).toBe(false);
  for (const origin of ["https://example.org/path", "https://user:password@example.org"]) {
    expect(
      allowlistSchema.safeParse({
        ...registry.allowlist,
        origins: [{ origin, purpose: "Administrative information" }],
      }).success,
    ).toBe(false);
  }
});
