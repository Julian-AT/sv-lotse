import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "@lotse/db";
import { formTemplates } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { JsonObjectSchema } from "@lotse/protocol";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../../approvals/index.ts";
import { acquireForm } from "../acquire/index.ts";
import { detectFields } from "../detect/index.ts";
import { FormError, type FormSchema, type Template, templateSchema } from "../schema.ts";
import { reconcileFormFields } from "./reconcile.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");

export async function getTemplate(db: DatabaseClient | Transaction, id: string): Promise<Template> {
  if (!z.uuid().safeParse(id).success) throw new FormError("not_found");
  const [template] = await db.select().from(formTemplates).where(eq(formTemplates.id, id));
  if (!template) throw new FormError("not_found");
  return template;
}

export async function templateForUse(
  db: DatabaseClient,
  id: string,
  signal?: AbortSignal,
): Promise<Template> {
  const template = await getTemplate(db, id);
  if (template.status === "verified" && template.schema.review) return template;
  return /^https:\/\//.test(template.source) ? acquireForm(db, template.source, signal) : template;
}

export async function getFormSchema(
  db: DatabaseClient,
  template: Template,
  signal?: AbortSignal,
): Promise<FormSchema> {
  const stored = z
    .object({
      fields: z.array(
        z.object({
          page: z.number().optional(),
          box: z.unknown().optional(),
          acro_field: z.string().optional(),
        }),
      ),
    })
    .parse(template.schema);
  return stored.fields.some((field) => field.acro_field && !field.page && !field.box)
    ? analyzeTemplate(db, template, signal)
    : templateSchema(template);
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/** SV-Box paths are registry metadata, never caller-controlled filesystem paths. */
export async function readTemplateAsset(template: Template): Promise<Uint8Array> {
  const assetSource =
    typeof template.schema.assetSource === "string" ? template.schema.assetSource : template.source;
  const source = assetSource.startsWith("svbox:")
    ? decodeURIComponent(assetSource.replace(/^svbox:\/?/, ""))
    : assetSource;
  let bytes: Uint8Array;
  if (
    !/^https?:\/\//.test(source) &&
    (process.env.NODE_ENV !== "production" || process.env.SVBOX_DIR)
  ) {
    // Local development/explicit mounts only. Production templates use their registered S3 key.
    // Do not trace the repository or original challenge files into the deployment bundle.
    const root = await realpath(
      /* turbopackIgnore: true */ resolve(repositoryRoot, process.env.SVBOX_DIR ?? "data/svbox"),
    );
    const local = source.replace(/^data\/svbox\//, "");
    const path = await realpath(/* turbopackIgnore: true */ resolve(root, local));
    if (!within(root, path)) throw new FormError("access_denied");
    bytes = await readFile(/* turbopackIgnore: true */ path);
  } else {
    const storage = createObjectStorage();
    try {
      bytes = await storage.get(template.storageKey);
    } finally {
      storage.close();
    }
  }
  if (createHash("sha256").update(bytes).digest("hex") !== template.hash)
    throw new FormError("asset_mismatch");
  return bytes;
}

export async function analyzeTemplate(
  db: DatabaseClient,
  template: Template,
  signal?: AbortSignal,
): Promise<FormSchema> {
  if (template.format === "html" || template.format === "xfa")
    throw new FormError("unsupported_format");
  if (template.status === "verified" && template.schema.review) return templateSchema(template);
  // A catalog schema carries reviewed fact mappings; do not replace it with detection guesses.
  const current = templateSchema(template);
  const draft = await detectFields(await readTemplateAsset(template), { signal });
  const fields = reconcileFormFields(
    current.fields,
    draft.fields.map((field) => ({
      ...field,
      page: field.box.page,
      validation: {},
    })),
  );
  const schema = JsonObjectSchema.parse(
    JSON.parse(
      JSON.stringify({
        ...template.schema,
        templateId: template.id,
        fields,
        pages: draft.pages,
        status: "auto",
      }),
    ),
  );
  await db
    .update(formTemplates)
    .set({ schema, status: "auto" })
    .where(eq(formTemplates.id, template.id));
  return templateSchema({ ...template, schema, status: "auto" });
}

export { reviewTemplate } from "./review.ts";
