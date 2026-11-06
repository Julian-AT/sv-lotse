import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { formFields, formInstances, formTemplates } from "@lotse/db/schema";
import { JsonObjectSchema } from "@lotse/protocol";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { authorizeFormCase } from "../instances/access.ts";
import {
  FormError,
  type FormField,
  type FormSchema,
  type Template,
  templateSchema,
} from "../schema.ts";
import { getTemplate, readTemplateAsset } from "./index.ts";
import { type ReviewedField, ReviewTemplateSchema } from "./schema.ts";

function reviewedField(input: ReviewedField, previous: FormField | undefined): FormField {
  const changedWidget =
    previous &&
    (JSON.stringify(previous.box) !== JSON.stringify(input.box) || previous.type !== input.type);
  const { acro_field, ...metadata } = previous ?? {};
  return {
    ...metadata,
    ...input,
    labels: previous?.label_de === input.label_de ? previous.labels : { de: input.label_de },
    page: input.box.page,
    signature: input.type === "signature" ? "subject" : (previous?.signature ?? "none"),
    method: previous?.method ?? "vector",
    confidence: previous?.confidence ?? 1,
    validation: previous?.validation ?? {},
    // Moved/resized native widgets must be rendered at the reviewed box, not the old annotation.
    ...(!changedWidget && acro_field ? { acro_field } : {}),
  };
}

async function validateBoxes(template: Template, fields: ReviewedField[]): Promise<void> {
  const document = await PDFDocument.load(await readTemplateAsset(template));
  const pages = document.getPages();
  const ids = new Set<string>();
  for (const field of fields) {
    const page = pages[field.box.page - 1];
    if (!page || ids.has(field.id)) throw new FormError("invalid_fields");
    ids.add(field.id);
    const crop = page.getCropBox();
    const rotated = Math.abs(page.getRotation().angle % 180) === 90;
    const width = rotated ? crop.height : crop.width;
    const height = rotated ? crop.width : crop.height;
    if (field.box.x + field.box.width > width || field.box.y + field.box.height > height)
      throw new FormError("invalid_fields");
  }
}

/** Immutable schema revision; only the subject-owned instance opts into the new version. */
export async function reviewTemplate(
  db: DatabaseClient,
  userId: string,
  templateId: string,
  raw: unknown,
): Promise<FormSchema> {
  const parsed = ReviewTemplateSchema.safeParse(raw);
  if (!parsed.success) throw new FormError("invalid_fields");
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const [instance] = await tx
      .select()
      .from(formInstances)
      .where(eq(formInstances.id, input.formInstanceId))
      .for("update");
    if (!instance) throw new FormError("not_found");
    await authorizeFormCase(tx, userId, instance.caseId, instance.subjectId);
    if (instance.templateId !== templateId) throw new FormError("invalid_fields");
    const template = await getTemplate(tx, templateId);
    if (template.format === "html" || template.format === "xfa")
      throw new FormError("unsupported_format");
    await validateBoxes(template, input.fields);
    const previous = templateSchema(template);
    const fields = input.fields.map((field) =>
      reviewedField(
        field,
        previous.fields.find((old) => old.id === field.id),
      ),
    );
    const id = randomUUID();
    const source =
      typeof template.schema.assetSource === "string"
        ? template.schema.assetSource
        : template.source;
    const schema = JsonObjectSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...template.schema,
          templateId: id,
          fields,
          status: "verified",
          assetSource: source,
          review: { previousTemplateId: template.id, reviewedAt: new Date().toISOString() },
        }),
      ),
    );
    // The existing source/hash uniqueness identifies downloaded bytes. A fragment identifies
    // an immutable review of those same bytes without a migration or changing the asset hash.
    const [saved] = await tx
      .insert(formTemplates)
      .values({
        ...template,
        id,
        source: `${source}#lotse-review=${id}`,
        schema,
        status: "verified",
        createdAt: new Date(),
      })
      .returning();
    if (!saved) throw new FormError("invalid_fields");
    const values = formFields.parse(instance.fields);
    await tx
      .update(formInstances)
      .set({
        templateId: id,
        outputKey: null,
        fields: Object.fromEntries(
          fields.flatMap((field) => {
            const value = values[field.id];
            return value
              ? [[field.id, { ...value, state: "draft" as const, approvalId: null }]]
              : [];
          }),
        ),
      })
      .where(eq(formInstances.id, instance.id));
    return templateSchema(saved);
  });
}
