import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { database, expect, storage, test } from "./fixtures.ts";

test("form renders real PDF, zooms, changes fill controls and persists or cancels keyboard corrections", async ({
  page,
  auditCase,
}) => {
  const templateId = randomUUID();
  const instanceId = randomUUID();
  const key = `controls-audit/${randomUUID()}.pdf`;
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([400, 600]);
  sheet.drawText("Applicant", { x: 20, y: 550 });
  pdf.getForm().createTextField("name").addToPage(sheet, { x: 20, y: 500, width: 160, height: 25 });
  await storage.put(key, await pdf.save(), "application/pdf");
  const schema = {
    fields: [
      {
        id: "name",
        acro_field: "name",
        label_de: "Name",
        type: "text",
        owner: "applicant",
        signature: "none",
        validation: { required: true },
      },
    ],
  };
  // Purpose-built administrative AcroForm fixture, backed by real MinIO and Postgres.
  await database.sql`INSERT INTO form_template (id, publisher, title, source, hash, format, pages, schema, storage_key)
    VALUES (${templateId}, 'Audit fixture', 'Verwaltungsformular', 'https://example.org/form.pdf', ${"0".repeat(64)}, 'acroform', 1, ${JSON.stringify(schema)}::jsonb, ${key})`;
  await database.sql`INSERT INTO form_instance (id, case_id, subject_id, template_id, fields)
    VALUES (${instanceId}, ${auditCase.id}, ${auditCase.subjectId}, ${templateId}, '{}'::jsonb)`;
  try {
    await page.goto(`/forms/${instanceId}`);
    await expect(
      page.getByRole("heading", { name: "Verwaltungsformular", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Vergrößern", exact: true }).click();
    await expect(page.locator("output")).toHaveText("125%");
    await page.getByRole("button", { name: "Verkleinern", exact: true }).click();
    await expect(page.locator("output")).toHaveText("100%");
    await page.getByLabel("Langsam ausfüllen", { exact: true }).check();
    await expect(page.getByLabel("Langsam ausfüllen", { exact: true })).toBeChecked();
    await page.getByLabel("Großer Zeiger", { exact: true }).check();
    await expect(page.getByLabel("Großer Zeiger", { exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Ausfüllen stoppen (Esc)", exact: true }).click();
    await expect(page.getByText("Ausfüllen gestoppt.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Korrigieren: Name", exact: true }).first().click();
    await page.getByLabel("Name", { exact: true }).fill("Nicht speichern");
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Korrigieren", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Ada");
    await page.getByRole("button", { name: "Korrektur speichern", exact: true }).click();
    await expect(
      page.getByLabel("Formularfelder").getByText("Ada", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Formularfelder").getByText("Ada", { exact: true }).first(),
    ).toBeVisible();
    const [row] = await database.sql`SELECT fields FROM form_instance WHERE id = ${instanceId}`;
    expect(row?.fields).toMatchObject({ name: { value: "Ada", state: "draft", approvalId: null } });
  } finally {
    await database.sql`DELETE FROM form_instance WHERE id = ${instanceId}`;
    await database.sql`DELETE FROM form_template WHERE id = ${templateId}`;
    await storage.delete(key);
  }
});
