import { createHash, randomUUID } from "node:crypto";
import { caseActors, formInstances, formTemplates } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { JsonObjectSchema } from "@lotse/protocol";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { RuntimeContext } from "../../../src/agent/context.ts";
import { resolveContext } from "../../../src/conversation/store.ts";
import { buildFormPackage } from "../../../src/forms/output/index.ts";
import {
  analyzeTemplate,
  getTemplate,
  readTemplateAsset,
  reviewTemplate,
  templateForUse,
} from "../../../src/forms/registry/index.ts";
import type { ReviewedField } from "../../../src/forms/registry/schema.ts";
import { identity, isolatedDatabase, turn } from "../../runtime/helpers.ts";
import { formNames, readForm, widgetGold } from "../detect/fixtures.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let context: RuntimeContext;
let helper: string;
let bytes: Uint8Array;
let source: string;
let field: ReviewedField;
let nativeName: string;
const outputKeys: string[] = [];

beforeAll(async () => {
  database = await isolatedDatabase();
  const session = await identity(database.db);
  context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
  helper = (await identity(database.db)).userId;
  await database.db.insert(caseActors).values({
    caseId: context.caseId,
    userId: helper,
    role: "helper",
    shareScope: { mode: "full" },
  });
  for (const name of await formNames()) {
    const candidate = await readForm(name);
    const document = await PDFDocument.load(candidate);
    const widget = (await widgetGold(candidate)).find(
      (item) =>
        item.type === "text" &&
        document.getPages()[item.box.page - 1]?.getRotation().angle === 0 &&
        item.box.x >= 0 &&
        item.box.y >= 0,
    );
    if (!widget) continue;
    bytes = candidate;
    source = `data/svbox/Anträge und Formulare/${name}`;
    nativeName = widget.name;
    // Test-only administrative mapping from a real PDF widget, independent of catalog semantics.
    field = {
      id: randomUUID(),
      label_de: widget.name,
      type: "text",
      owner: "applicant",
      box: widget.box,
    };
    return;
  }
  throw new Error("No native text field found");
}, 30000);

afterAll(async () => {
  if (!database) return;
  const storage = createObjectStorage();
  try {
    for (const key of outputKeys) await storage.delete(key);
  } finally {
    storage.close();
    await database.cleanup();
  }
});

async function draft() {
  const id = randomUUID();
  await database.db.insert(formTemplates).values({
    id,
    title: "Review",
    publisher: "Official PDF fixture",
    source: `${source}`,
    hash: createHash("sha256").update(bytes).digest("hex"),
    format: "acroform",
    pages: (await PDFDocument.load(bytes)).getPageCount(),
    status: "auto",
    schema: JsonObjectSchema.parse({
      fields: [
        {
          ...field,
          page: field.box.page,
          acro_field: nativeName,
          signature: "none",
          method: "acroform",
          confidence: 0.9,
          validation: {},
          fact_type: "administrative.statement",
        },
      ],
    }),
    storageKey: "unused-local-original",
  });
  const [instance] = await database.db
    .insert(formInstances)
    .values({
      caseId: context.caseId,
      subjectId: context.subjectId,
      templateId: id,
      fields: {
        [field.id]: {
          value: "Review value",
          provenance: {
            source: { kind: "statement", quote: "Review value", turnId: randomUUID() },
          },
          state: "confirmed",
          approvalId: randomUUID(),
        },
      },
      outputKey: "stale-output",
    })
    .returning();
  if (!instance) throw new Error("Missing instance");
  return { templateId: id, formInstanceId: instance.id, fields: [field] };
}

// Each test uses one real source/hash. Remove only its own fixture after each assertion group.
async function clearFixture(id: string): Promise<void> {
  await database.db.delete(formInstances).where(eq(formInstances.caseId, context.caseId));
  await database.db.delete(formTemplates).where(eq(formTemplates.id, id));
}

test("FR-D11 only subject actors can review; malformed and stale edits create no versions", async () => {
  const input = await draft();
  await expect(
    reviewTemplate(database.db, helper, input.templateId, {
      formInstanceId: input.formInstanceId,
      fields: input.fields,
    }),
  ).rejects.toMatchObject({ code: "access_denied" });
  await expect(
    reviewTemplate(database.db, randomUUID(), input.templateId, {
      formInstanceId: input.formInstanceId,
      fields: input.fields,
    }),
  ).rejects.toMatchObject({ code: "access_denied" });
  for (const fields of [
    [field, field],
    [{ ...field, box: { ...field.box, page: 10000 } }],
    [{ ...field, box: { ...field.box, x: 100000 } }],
    [{ ...field, fact_type: "caller.mapping" }],
  ]) {
    await expect(
      reviewTemplate(database.db, context.userId, input.templateId, {
        formInstanceId: input.formInstanceId,
        fields,
      }),
    ).rejects.toMatchObject({ code: "invalid_fields" });
  }
  expect(await database.db.select().from(formTemplates)).toHaveLength(1);
  expect((await getTemplate(database.db, input.templateId)).status).toBe("auto");
  await clearFixture(input.templateId);
});

test("FR-D11 review creates immutable verified versions, reuses bytes and package.build places reviewed boxes", async () => {
  const input = await draft();
  const moved = { ...field, box: { page: field.box.page, x: 20, y: 30, width: 120, height: 24 } };
  const added: ReviewedField = {
    id: randomUUID(),
    label_de: "Additional administrative entry",
    type: "checkbox",
    owner: "office",
    box: { ...moved.box, y: 100 },
  };
  const reviewed = await reviewTemplate(database.db, context.userId, input.templateId, {
    formInstanceId: input.formInstanceId,
    fields: [moved, added],
  });
  expect(reviewed.status).toBe("verified");
  expect(reviewed.templateId).not.toBe(input.templateId);
  expect(reviewed.fields[0]).toMatchObject({
    box: moved.box,
    fact_type: "administrative.statement",
  });
  expect(reviewed.fields[0]?.acro_field).toBeUndefined();
  expect((await getTemplate(database.db, input.templateId)).status).toBe("auto");
  const saved = await getTemplate(database.db, reviewed.templateId);
  expect(new Uint8Array(await readTemplateAsset(saved))).toEqual(bytes);
  expect((await analyzeTemplate(database.db, saved)).fields).toEqual(reviewed.fields);
  expect((await templateForUse(database.db, reviewed.templateId)).id).toBe(reviewed.templateId);
  const [instance] = await database.db
    .select()
    .from(formInstances)
    .where(eq(formInstances.id, input.formInstanceId));
  expect(instance).toMatchObject({
    templateId: reviewed.templateId,
    outputKey: null,
    fields: { [field.id]: { state: "draft", approvalId: null } },
  });
  if (!instance) throw new Error("Missing instance");
  // Test-only stand-in for the separately tested approval flow: verify package geometry after approval.
  const entry = instance.fields[field.id];
  if (!entry) throw new Error("Missing value");
  await database.db
    .update(formInstances)
    .set({ fields: { [field.id]: { ...entry, state: "confirmed", approvalId: randomUUID() } } })
    .where(eq(formInstances.id, instance.id));
  const built = await buildFormPackage(
    database.db,
    { caseId: context.caseId, formInstanceId: instance.id },
    context,
  );
  outputKeys.push(built.pdfKey);
  const storage = createObjectStorage();
  let result: PDFDocument;
  try {
    result = await PDFDocument.load(await storage.get(built.pdfKey));
  } finally {
    storage.close();
  }
  const widget = result.getForm().getTextField(`lotse.${field.id}`).acroField.getWidgets()[0];
  const outputPage = result.getPages()[moved.box.page - 1];
  if (!outputPage) throw new Error("Missing output page");
  expect(widget?.getRectangle()).toMatchObject({
    x: 20,
    y: outputPage.getHeight() - 30 - 24,
    width: 120,
    height: 24,
  });
  await expect(
    reviewTemplate(database.db, context.userId, input.templateId, {
      formInstanceId: input.formInstanceId,
      fields: [moved],
    }),
  ).rejects.toMatchObject({ code: "invalid_fields" });
  const next = await reviewTemplate(database.db, context.userId, reviewed.templateId, {
    formInstanceId: input.formInstanceId,
    fields: [moved, { ...added, type: "signature" }],
  });
  expect(next.fields[1]).toMatchObject({
    type: "signature",
    signature: "subject",
    owner: "office",
  });
  expect((await getTemplate(database.db, reviewed.templateId)).schema).toEqual(saved.schema);
});
