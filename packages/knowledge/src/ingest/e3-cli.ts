import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDatabase } from "@lotse/db";
import { sourcesFromManifest } from "./e3-sources.ts";
import { resolveEmbedder } from "./embed.ts";
import { loadEnvironment } from "./environment.ts";
import { FetchError, IngestionFetcher } from "./fetcher.ts";
import { ingestSource } from "./pipeline.ts";
import { loadRegistry } from "./registry.ts";

async function main(): Promise<void> {
  loadEnvironment();
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false } },
  });
  const registry = await loadRegistry();
  const seeds = sourcesFromManifest(
    JSON.parse(
      await readFile(new URL("../../../evals/sets/e3/sources.json", import.meta.url), "utf8"),
    ),
    registry.sources,
  );
  const fetcher = new IngestionFetcher(registry.allowlist.origins.map(({ origin }) => origin));
  const database = values["dry-run"] ? null : createDatabase();
  const embedder = database ? await resolveEmbedder() : null;
  let failed = 0;
  try {
    for (const seed of seeds) {
      const uri = seed.url;
      try {
        const result = await ingestSource(database, fetcher, seed, embedder);
        const success = ["indexed", "unchanged", "not_modified", "dry_run"].includes(result.status);
        if (!success) failed++;
        process.stdout.write(`${JSON.stringify({ event: "e3_source", url: uri, ...result })}\n`);
      } catch (error) {
        failed++;
        process.stderr.write(
          `${JSON.stringify({ event: "e3_source_failed", url: uri, code: error instanceof FetchError ? error.code : "ingestion_failed" })}\n`,
        );
      }
    }
    process.stdout.write(
      `${JSON.stringify({ event: "e3_ingested", sources: seeds.length, failed })}\n`,
    );
    if (failed) process.exitCode = 1;
  } finally {
    await database?.close();
  }
}

main().catch(() => {
  process.stderr.write('{"event":"e3_ingestion_failed","code":"configuration_or_service_error"}\n');
  process.exitCode = 1;
});
