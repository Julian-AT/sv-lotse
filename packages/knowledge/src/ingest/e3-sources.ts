import { z } from "zod";
import { type SourceSeed, sourceSchema } from "./registry.ts";

// Gold excerpts and question metadata never enter the ingestion boundary.
const manifestSchema = z
  .array(z.object({ uri: z.url() }))
  .min(1)
  .refine(
    (sources) => new Set(sources.map(({ uri }) => uri)).size === sources.length,
    "Duplicate source URLs",
  );

export function sourcesFromManifest(raw: unknown, registry: readonly SourceSeed[]): SourceSeed[] {
  return manifestSchema.parse(raw).map(({ uri }) => {
    const registered =
      registry.find(({ url }) => url === uri) ??
      registry.find(({ url }) => new URL(url).origin === new URL(uri).origin);
    if (!registered) throw new Error("E3 source origin has no registered routing metadata");
    return sourceSchema.parse({ ...registered, url: uri });
  });
}
