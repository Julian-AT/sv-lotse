import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FormSchema } from "@lotse/knowledge";
import { z } from "zod";
import { checkGold, dataset, jsonFile, ROOT, SETS, verifiedBytes } from "../baseline/data.ts";
import { E7_CONFIG } from "../config.ts";
import type { EvalCase, Suite } from "../schema/index.ts";

export const E7InputSchema = z.object({
  form: z.string().min(1),
  persona: z.string().min(1),
  facts: z.array(
    z.object({
      type: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
      confirmed: z.literal(true),
      source: z.enum(["statement", "document"]),
      quote: z.string().min(1),
    }),
  ),
});
export const E7ExpectedSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
const ManifestSchema = z
  .array(
    z.object({
      schema: z.string().regex(/^svbox-[a-z-]+\.json$/u),
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      pages: z.number().int().positive(),
      publisher: z.url(),
    }),
  )
  .length(E7_CONFIG.formCount);

type E7Form = Omit<z.infer<typeof ManifestSchema>[number], "schema"> & {
  schema: z.infer<typeof FormSchema>;
  bytes: Uint8Array;
};

export async function loadE7(): Promise<{ suite: Suite; cases: EvalCase[]; forms: E7Form[] }> {
  const data = await dataset("E7");
  await checkGold(data.cases);
  const manifest = ManifestSchema.parse(await jsonFile(resolve(SETS, "e7/forms.json")));
  const directory = resolve(ROOT, "packages/knowledge/forms");
  const declared = manifest.map((item) => item.schema).sort();
  const actual = (await readdir(directory)).filter((name) => name.startsWith("svbox-")).sort();
  if (JSON.stringify(declared) !== JSON.stringify(actual)) throw new Error("e7_schema_coverage");
  const forms = await Promise.all(
    manifest.map(async (entry) => {
      const schema = FormSchema.parse(
        JSON.parse(await readFile(resolve(directory, entry.schema), "utf8")),
      );
      const bytes = await verifiedBytes(
        resolve(ROOT, process.env.SVBOX_DIR ?? "data/svbox"),
        entry.path,
        entry.sha256,
      );
      return { ...entry, schema, bytes };
    }),
  );
  if (new Set(data.cases.map((item) => item.id)).size !== data.cases.length)
    throw new Error("e7_duplicate_case");
  for (const form of forms) {
    const cases = data.cases.filter(
      (item) => E7InputSchema.parse(item.input).form === form.schema.id,
    );
    if (
      cases.length !== E7_CONFIG.personasPerForm ||
      new Set(cases.map((item) => E7InputSchema.parse(item.input).persona)).size !==
        E7_CONFIG.personasPerForm
    )
      throw new Error("e7_persona_coverage");
    for (const item of cases) {
      const expected = E7ExpectedSchema.parse(item.expected);
      const ids = form.schema.fields.map((field) => field.id).sort();
      if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(ids))
        throw new Error("e7_field_coverage");
      if (
        form.schema.fields.some(
          (field) =>
            (field.owner !== "applicant" || field.signature !== "none") &&
            expected[field.id] !== null,
        )
      )
        throw new Error("e7_protected_gold");
    }
  }
  if (data.cases.length !== forms.length * E7_CONFIG.personasPerForm)
    throw new Error("e7_case_coverage");
  return { ...data, forms };
}
