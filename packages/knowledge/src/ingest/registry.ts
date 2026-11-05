import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { AllowlistSchema } from "../schemas/common.ts";

const publicUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash;
}, "Public URLs cannot contain credentials or fragments");
export const allowlistSchema = AllowlistSchema.refine(
  ({ origins }) => new Set(origins.map((entry) => entry.origin)).size === origins.length,
  "Duplicate origins",
);

export const sourceSchema = z.strictObject({
  url: publicUrl,
  publisher: z.string().min(1),
  refresh_days: z.number().int().positive(),
  carrier: z.string().min(1).nullable(),
  region: z.string().min(1),
  life_situations: z.array(z.string().min(1)),
});
export type SourceSeed = z.infer<typeof sourceSchema>;
export const sourcesSchema = z
  .array(sourceSchema)
  .min(1)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.url)).size === entries.length,
    "Duplicate sources",
  );
export const synonymsSchema = z.strictObject({
  groups: z
    .array(
      z
        .array(z.string().trim().min(1))
        .min(2)
        .refine(
          (terms) =>
            new Set(terms.map((term) => term.toLocaleLowerCase("de-AT"))).size === terms.length,
          "Duplicate synonym terms",
        ),
    )
    .min(1),
});

export async function loadRegistry(directory = new URL("../../", import.meta.url)) {
  const [allowlist, sources, synonyms] = await Promise.all([
    readFile(new URL("allowlist.yaml", directory), "utf8").then((value) =>
      allowlistSchema.parse(parse(value)),
    ),
    readFile(new URL("ingest-sources.yaml", directory), "utf8").then((value) =>
      sourcesSchema.parse(parse(value)),
    ),
    readFile(new URL("synonyms.yaml", directory), "utf8").then((value) =>
      synonymsSchema.parse(parse(value)),
    ),
  ]);
  const origins = new Set(allowlist.origins.map((entry) => entry.origin));
  if (sources.some((entry) => !origins.has(new URL(entry.url).origin))) {
    throw new Error("Source registry contains an unlisted origin");
  }
  return { allowlist, sources, synonyms };
}
