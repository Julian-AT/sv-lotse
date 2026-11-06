import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourcesSchema } from "@lotse/knowledge/ingest";
import { z } from "zod";

export const DEMO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEMO_MANIFEST = new URL(
  "../../packages/knowledge/demo/discharge.json",
  import.meta.url,
);
export const DEMO_INGEST_TIMEOUT_MS = 120_000;
export const demoManifestSchema = z.strictObject({
  displayName: z.string().min(1),
  document: z.string().min(1),
  sources: sourcesSchema,
  form: z.strictObject({
    file: z.string().min(1),
    title: z.string().min(1),
    publisher: z.string().min(1),
    sourceQuote: z.string().min(1),
    mappings: z.array(
      z.strictObject({ acroField: z.string().min(1), factType: z.string().min(1) }),
    ),
  }),
});
export type DemoManifest = z.infer<typeof demoManifestSchema>;

export async function loadDemoManifest(): Promise<DemoManifest> {
  return demoManifestSchema.parse(JSON.parse(await readFile(DEMO_MANIFEST, "utf8")));
}

export function demoAsset(path: string): string {
  return resolve(DEMO_ROOT, process.env.SVBOX_DIR ?? "data/svbox", path);
}
