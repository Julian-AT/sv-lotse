import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createFormViewerService } from "@lotse/brain/forms/viewer";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, expect, test } from "vitest";

const environment = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(environment)) loadEnvFile(environment);
const admin = createDatabase();
const name = `viewer_${randomUUID().replaceAll("-", "")}`;
const url = new URL(admin.config.DATABASE_URL);
url.pathname = `/${name}`;
const database = createDatabase({ ...process.env, DATABASE_URL: url.href });
const storage = createObjectStorage();
const owner = randomUUID();
const outsider = randomUUID();
const subject = randomUUID();
const caseId = randomUUID();
const templateId = randomUUID();
const instanceId = randomUUID();
const storageKey = `viewer-test/${randomUUID()}.pdf`;
const service = createFormViewerService(database, owner);
let created = false;
let stored = false;
let bytes: Uint8Array;

beforeAll(async () => {
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
  created = true;
  await migrateDatabase(database);
  // Synthetic administrative PDF: real PDF bytes and real Postgres/MinIO, no provider doubles.
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]);
  bytes = await pdf.save();
  await storage.put(storageKey, bytes, "application/pdf");
  stored = true;
  await database.sql`INSERT INTO "user" (id) VALUES (${owner}), (${outsider})`;
  await database.sql`INSERT INTO subject (id, display_name, relation_to_user, created_by)
    VALUES (${subject}, 'Testperson', 'self', ${owner})`;
  await database.sql`INSERT INTO "case" (id, subject_id, confirmed_goal)
    VALUES (${caseId}, ${subject}, 'Formular vorbereiten')`;
  await database.sql`INSERT INTO case_actor (case_id, user_id, role, share_scope)
    VALUES (${caseId}, ${outsider}, 'helper', '{"mode":"full"}'::jsonb)`;
  const fields = ["field-a", "field-b", "field-reserved", "field-signature"].map((id, index) => ({
    id,
    label_de: id,
    type: index === 3 ? "signature" : "text",
    owner: index === 2 ? "office" : "applicant",
    signature: index === 3 ? "subject" : "none",
    box: { page: 1, x: 20, y: 20 + index * 60, width: 150, height: 25 },
    fact_type: "administrative.statement",
    validation: { required: true, max_length: 30 },
  }));
  await database.sql`INSERT INTO form_template (id, publisher, title, source, hash, format, pages, schema, storage_key)
    VALUES (${templateId}, 'Test', 'Testformular', 'https://example.org/form.pdf', ${"0".repeat(64)},
      'flat', 1, ${JSON.stringify({ fields })}::jsonb, ${storageKey})`;
  await database.sql`INSERT INTO form_instance (id, case_id, subject_id, template_id, fields)
    VALUES (${instanceId}, ${caseId}, ${subject}, ${templateId}, '{}'::jsonb)`;
}, 30000);

afterAll(async () => {
  try {
    if (stored) await storage.delete(storageKey);
  } finally {
    storage.close();
    await database.close();
    try {
      if (created) await admin.sql`DROP DATABASE ${admin.sql(name)}`;
    } finally {
      await admin.close();
    }
  }
});

test("FR-D5 reads the session owner's instance and the original PDF from real object storage", async () => {
  const result = await service.read(instanceId);
  expect(result.instance.schema.fields).toHaveLength(4);
  expect(new Uint8Array(await storage.get(result.storageKey))).toEqual(bytes);
});

test("FR-D5 an unrelated user and a helper cannot read unprojected provenance or change fields", async () => {
  const helper = createFormViewerService(database, outsider);
  await expect(helper.read(instanceId)).rejects.toMatchObject({ code: "not_found" });
  await expect(
    helper.correct(instanceId, { fieldId: "field-a", value: "No" }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    createFormViewerService(database, randomUUID()).read(instanceId),
  ).rejects.toMatchObject({ code: "not_found" });
});

test("FR-D5 concurrent keyboard corrections preserve both fields as drafts and create statement facts", async () => {
  await Promise.all([
    service.correct(instanceId, { fieldId: "field-a", value: "Ada" }),
    service.correct(instanceId, { fieldId: "field-b", value: "Wien" }),
  ]);
  const { instance } = await service.read(instanceId);
  expect(instance.fields["field-a"]).toMatchObject({
    value: "Ada",
    state: "draft",
    approvalId: null,
    provenance: { source: { kind: "statement", quote: "Ada" } },
  });
  expect(instance.fields["field-b"]?.value).toBe("Wien");
  const facts =
    await database.sql`SELECT value, confirmed, source, turn_id FROM fact WHERE subject_id = ${subject}`;
  expect(facts).toHaveLength(2);
  for (const fact of facts) {
    expect(fact.confirmed).toBe(true);
    expect(fact.turn_id).toBeTruthy();
    expect(fact.source).toMatchObject({ kind: "statement", quote: fact.value });
  }
});

test("FR-D5 reserved, signature, invalid and forged confirmation writes have no side effects", async () => {
  for (const input of [
    { fieldId: "field-reserved", value: "No" },
    { fieldId: "field-signature", value: "No" },
    { fieldId: "field-a", value: "" },
    { fieldId: "field-a", value: "x".repeat(31) },
    { fieldId: "unknown", value: "No" },
    { fieldId: "field-a", value: "No", state: "confirmed" },
  ])
    await expect(service.correct(instanceId, input)).rejects.toMatchObject({
      code: "invalid_input",
    });
  expect(await database.sql`SELECT id FROM fact WHERE subject_id = ${subject}`).toHaveLength(2);
});
