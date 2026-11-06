import { readFile } from "node:fs/promises";
import { z } from "zod";

const schema = z.strictObject({
  reviewedAt: z.iso.date(),
  exportUrl: z.url(),
  rulesUrl: z.url(),
  requester: z.string().min(1),
  conditional: z.string().min(1),
  subsequentControl: z.string().min(1),
  sources: z.array(z.strictObject({ url: z.url(), asOf: z.iso.date(), quote: z.string().min(1) })),
});
export type EkoAdministration = z.infer<typeof schema>;

/** Review dates describe provenance checks, never an invented export effective date. */
export async function loadEkoAdministration(): Promise<EkoAdministration> {
  return schema.parse(
    JSON.parse(await readFile(new URL("./administration.json", import.meta.url), "utf8")),
  );
}
