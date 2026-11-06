import { readFile } from "node:fs/promises";
import { z } from "zod";

const text = z.string().min(1);
const schema = z.strictObject({
  asOf: z.iso.date(),
  rate: z.number().positive().max(1),
  carrier: text,
  scheduleBaseUrl: z.url(),
  scopeText: text,
  ruleText: text,
  requiredDocuments: z.array(text).min(1),
  onlineUrl: z.url(),
  submissionText: text,
  sources: z.array(z.strictObject({ url: z.url(), asOf: z.iso.date(), quote: text })).min(1),
});
export type ReimbursementRules = z.infer<typeof schema>;

export async function loadReimbursementRules(): Promise<ReimbursementRules> {
  return schema.parse(
    JSON.parse(await readFile(new URL("./administration.json", import.meta.url), "utf8")),
  );
}
