import { readFile } from "node:fs/promises";
import type { Database } from "@lotse/db";
import { parse } from "yaml";
import { z } from "zod";
import { sozdokFiles } from "../loaders/sozdok/directory.ts";
import { loadSozdok } from "../loaders/sozdok/load.ts";
import { resolveEmbedder } from "./embed.ts";
import { IngestionFetcher } from "./fetcher.ts";
import { ingestSource } from "./pipeline.ts";
import { loadRegistry, sourcesSchema } from "./registry.ts";

export const pilotManifestSchema = z.strictObject({
  sources: sourcesSchema,
  provisions: z
    .array(
      z.strictObject({ law: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) }),
    )
    .min(1),
});
export async function ingestPilot(
  database: Database | null,
  on: string,
): Promise<{ pages: number; failed: number; legalSources: number; legalChunks: number }> {
  z.iso.date().parse(on);
  if (database) await sozdokFiles();
  const manifest = pilotManifestSchema.parse(
    parse(await readFile(new URL("../../ingest-pilot.yaml", import.meta.url), "utf8")),
  );
  const registry = await loadRegistry();
  const fetcher = new IngestionFetcher(registry.allowlist.origins.map((origin) => origin.origin));
  const embedder = database ? await resolveEmbedder() : undefined;
  let pages = 0;
  let failed = 0;
  for (const seed of manifest.sources) {
    try {
      const result = await ingestSource(database, fetcher, seed, embedder ?? null);
      if (["indexed", "unchanged", "not_modified", "dry_run"].includes(result.status)) pages++;
      else failed++;
      process.stdout.write(
        `${JSON.stringify({ event: "pilot_page", origin: new URL(seed.url).origin, status: result.status })}\n`,
      );
    } catch {
      failed++;
      process.stderr.write(
        `${JSON.stringify({ event: "pilot_page_failed", origin: new URL(seed.url).origin })}\n`,
      );
    }
  }
  const legal =
    database && embedder
      ? await loadSozdok(database, {
          on,
          provisions: manifest.provisions,
          embeddingIdentity: embedder.identity,
          embed: async (chunk) => {
            const [vector] = await embedder([chunk.text]);
            if (!vector) throw new Error("EMBEDDING_MISSING");
            return vector;
          },
        })
      : { sources: 0, chunks: 0 };
  return { pages, failed, legalSources: legal.sources, legalChunks: legal.chunks };
}
