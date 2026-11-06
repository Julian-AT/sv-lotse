import { expect, test } from "vitest";
import { sourcesFromManifest } from "../../src/ingest/e3-sources.ts";
import { loadRegistry } from "../../src/ingest/registry.ts";

test("E3 source URLs inherit registered routing metadata and discard gold excerpts", async () => {
  const registry = await loadRegistry();
  const registered = registry.sources[0];
  if (!registered) throw new Error("Missing source registry");
  const url = new URL("/example-article", registered.url).href;
  const [source] = sourcesFromManifest(
    [{ uri: url, passages: ["Never ingest this gold excerpt"] }],
    registry.sources,
  );
  expect(source).toEqual({ ...registered, url });
  expect(JSON.stringify(source)).not.toContain("Never ingest");
});

test("unregistered origins and repeated E3 URLs fail before fetching or embedding", async () => {
  const registry = await loadRegistry();
  expect(() =>
    sourcesFromManifest([{ uri: "https://example.invalid/article" }], registry.sources),
  ).toThrow();
  const registered = registry.sources[0];
  if (!registered) throw new Error("Missing source registry");
  expect(() =>
    sourcesFromManifest([{ uri: registered.url }, { uri: registered.url }], registry.sources),
  ).toThrow();
});
