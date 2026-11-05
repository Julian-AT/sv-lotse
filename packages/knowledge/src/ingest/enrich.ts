import { createHash } from "node:crypto";
import { z } from "zod";
import { chunkMarkdown } from "./chunk.ts";
import type { NormalizedPage } from "./normalize.ts";
import { type SourceSeed, sourceSchema } from "./registry.ts";

export const metadataSchema = z.object({
  url: z.url(),
  title: z.string(),
  heading_path: z.array(z.string()),
  carrier: z.string().nullable(),
  region: z.string(),
  life_situations: z.array(z.string()),
  language: z.string(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  retrieved_at: z.iso.datetime(),
});
export type ChunkMetadata = z.infer<typeof metadataSchema>;
export interface IngestionDocument {
  url: string;
  publisher: string;
  text: string;
  metadata: ChunkMetadata;
  valid_from: string | null;
  valid_to: string | null;
  chunks: {
    text: string;
    metadata: ChunkMetadata;
    size_exception: string | null;
    valid_from: string | null;
    valid_to: string | null;
  }[];
}

export function enrich(
  page: NormalizedPage,
  input: SourceSeed,
  retrieved_at: string,
): IngestionDocument {
  const seed = sourceSchema.parse(input);
  // Hash the searchable representation AND routing/validity metadata. A carrier or
  // legal-validity correction must reindex even when the prose is unchanged.
  const content_hash = createHash("sha256")
    .update(
      JSON.stringify({
        markdown: page.markdown,
        title: page.title,
        language: page.language,
        carrier: seed.carrier,
        region: seed.region,
        life_situations: seed.life_situations,
        publisher: seed.publisher,
        url: seed.url,
        valid_from: page.valid_from,
        valid_to: page.valid_to,
        sections: page.sections,
      }),
    )
    .digest("hex");
  const metadata = metadataSchema.parse({
    url: seed.url,
    title: page.title,
    heading_path: [],
    carrier: seed.carrier,
    region: seed.region,
    life_situations: seed.life_situations,
    language: page.language,
    content_hash,
    retrieved_at,
  });
  if (page.valid_from && page.valid_to && page.valid_to <= page.valid_from)
    throw new Error("Invalid source validity interval");
  return {
    url: seed.url,
    publisher: seed.publisher,
    text: page.markdown,
    metadata,
    valid_from: page.valid_from,
    valid_to: page.valid_to,
    chunks: page.sections.flatMap((section) => {
      if (section.valid_from && section.valid_to && section.valid_to <= section.valid_from)
        throw new Error("Invalid section validity interval");
      return chunkMarkdown(section.markdown).map((chunk) => ({
        text: chunk.text,
        metadata: { ...metadata, heading_path: chunk.heading_path },
        size_exception: chunk.size_exception,
        valid_from: section.valid_from,
        valid_to: section.valid_to,
      }));
    }),
  };
}
