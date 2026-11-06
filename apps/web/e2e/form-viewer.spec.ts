import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createDatabase } from "@lotse/db";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

const database = createDatabase();
const storage = createObjectStorage();
test.afterAll(async () => {
  await database.close();
  storage.close();
});

test("FR-D5 real PDF renders aligned fields, reports native rectangles and saves keyboard corrections @form-viewer", async ({
  page,
  context,
  playwright,
}) => {
  const subjectId = randomUUID();
  const caseId = randomUUID();
  const templateId = randomUUID();
  const instanceId = randomUUID();
  const key = `viewer-e2e/${randomUUID()}.pdf`;
  let userId: string | undefined;
  try {
    // Purpose-built administrative fixture: real AcroForm, storage, HTTP and database.
    const pdf = await PDFDocument.create();
    const pdfPage = pdf.addPage([400, 600]);
    pdfPage.drawText("Applicant", { x: 20, y: 550, size: 12 });
    pdf
      .getForm()
      .createTextField("applicant-name")
      .addToPage(pdfPage, { x: 20, y: 500, width: 150, height: 25, borderWidth: 0 });
    await storage.put(key, await pdf.save(), "application/pdf");
    const identity = z
      .object({ userId: z.uuid() })
      .parse(await (await context.request.post("/api/session")).json());
    userId = identity.userId;
    await database.sql`INSERT INTO subject (id, display_name, relation_to_user, created_by)
      VALUES (${subjectId}, 'Testperson', 'self', ${userId})`;
    await database.sql`INSERT INTO "case" (id, subject_id, confirmed_goal) VALUES (${caseId}, ${subjectId}, 'Formular vorbereiten')`;
    const schema = {
      fields: [
        {
          id: "field-a",
          acro_field: "applicant-name",
          label_de: "Name",
          type: "text",
          owner: "applicant",
          signature: "none",
          fact_type: "administrative.statement",
          validation: { required: true },
        },
      ],
    };
    await database.sql`INSERT INTO form_template (id, publisher, title, source, hash, format, pages, schema, storage_key)
      VALUES (${templateId}, 'Test', 'Testformular', 'https://example.org/form.pdf', ${"0".repeat(64)}, 'acroform', 1, ${JSON.stringify(schema)}::jsonb, ${key})`;
    await database.sql`INSERT INTO form_instance (id, case_id, subject_id, template_id, fields)
      VALUES (${instanceId}, ${caseId}, ${subjectId}, ${templateId}, '{}'::jsonb)`;

    await page.addInitScript(() => {
      const rectangles: unknown[] = [];
      Reflect.set(window, "testTargetRects", rectangles);
      Reflect.set(window, "webkit", {
        messageHandlers: {
          lotse: {
            postMessage: async (message: unknown) => {
              rectangles.push(message);
              return { accepted: true };
            },
          },
        },
      });
    });
    await page.goto(`/forms/${instanceId}`);
    await expect(page.getByRole("heading", { name: "Testformular" })).toBeVisible();
    const overlay = page.getByRole("button", { name: "Korrigieren: Name" }).first();
    await expect(overlay).toBeVisible();
    const canvas = await page.locator("canvas").boundingBox();
    const field = await overlay.boundingBox();
    if (!canvas || !field) throw new Error("Field geometry missing");
    expect(field.x - canvas.x).toBeCloseTo(20, 0);
    expect(field.y - canvas.y).toBeCloseTo(75, 0);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "testTargetRects").length))
      .toBeGreaterThan(0);
    const worker = await context.request.get("/api/pdfjs/build/pdf.worker.min.mjs");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("javascript");
    const response = await context.request.get(`/api/forms/${instanceId}/pdf`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const anonymous = await playwright.request.newContext();
    try {
      expect(
        (await anonymous.get(`http://localhost:3000/api/forms/${instanceId}/pdf`)).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    await overlay.click();
    await page.getByLabel("Name", { exact: true }).fill("Ada");
    await page.getByRole("button", { name: "Korrektur speichern" }).click();
    await expect(
      page.getByLabel("Formularfelder").getByText("Ada", { exact: true }).first(),
    ).toBeVisible();
    const [row] = await database.sql`SELECT fields FROM form_instance WHERE id = ${instanceId}`;
    expect(row?.fields).toMatchObject({
      "field-a": {
        value: "Ada",
        state: "draft",
        approvalId: null,
        provenance: { source: { kind: "statement", quote: "Ada" } },
      },
    });
    await page.getByRole("button", { name: "Vergrößern", exact: true }).click();
    await expect(page.locator("output")).toHaveText("125%");
    await expect.poll(async () => (await overlay.boundingBox())?.x).toBeDefined();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({ path: "test-results/form-viewer.png", fullPage: true });
  } finally {
    await database.sql`DELETE FROM subject WHERE id = ${subjectId}`;
    await database.sql`DELETE FROM form_template WHERE id = ${templateId}`;
    if (userId) await database.sql`DELETE FROM "user" WHERE id = ${userId}`;
    await storage.delete(key);
  }
});
