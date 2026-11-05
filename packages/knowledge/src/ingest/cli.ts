import { parseArgs } from "node:util";
import { createDatabase } from "@lotse/db";
import { z } from "zod";
import { resolveEmbedder } from "./embed.ts";
import { loadEnvironment } from "./environment.ts";
import { FetchError, IngestionFetcher } from "./fetcher.ts";
import { ingestSource } from "./pipeline.ts";
import { loadRegistry } from "./registry.ts";

async function main(): Promise<void> {
  loadEnvironment();
  const { values } = parseArgs({
    options: {
      origin: { type: "string" },
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const limit = z.coerce
    .number()
    .int()
    .positive()
    .parse(values.limit ?? Number.MAX_SAFE_INTEGER);
  const registry = await loadRegistry();
  const requestedOrigin = values.origin
    ? new URL(values.origin.includes("://") ? values.origin : `https://${values.origin}`).origin
    : null;
  if (
    requestedOrigin &&
    !registry.allowlist.origins.some((entry) => entry.origin === requestedOrigin)
  )
    throw new FetchError("origin_denied");
  const sources = registry.sources
    .filter((seed) => !requestedOrigin || new URL(seed.url).origin === requestedOrigin)
    .slice(0, limit);
  const fetcher = new IngestionFetcher(registry.allowlist.origins.map((entry) => entry.origin));
  const database = values["dry-run"] ? null : createDatabase();
  try {
    const embed = values["dry-run"] ? null : await resolveEmbedder();
    for (const source of sources) {
      try {
        const result = await ingestSource(database, fetcher, source, embed);
        process.stdout.write(
          `${JSON.stringify({ event: "ingest", origin: new URL(source.url).origin, ...result })}\n`,
        );
      } catch (error) {
        // No exception messages: provider and driver errors may contain secrets.
        process.stderr.write(
          `${JSON.stringify({ event: "ingest_failed", origin: new URL(source.url).origin, code: error instanceof FetchError ? error.code : "ingestion_failed" })}\n`,
        );
        process.exitCode = 1;
      }
    }
  } finally {
    await database?.close();
  }
}

main().catch(() => {
  process.stderr.write('{"event":"ingest_failed","code":"configuration_or_service_error"}\n');
  process.exitCode = 1;
});
