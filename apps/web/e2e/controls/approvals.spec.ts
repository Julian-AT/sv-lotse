import { randomUUID } from "node:crypto";
import { approvals } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { seedApproval } from "./approval-fixture.ts";
import { database, expect, storage, test } from "./fixtures.ts";

for (const screen of ["workspace"] as const) {
  for (const approved of [true, false]) {
    test(`${screen} ${approved ? "approves" : "declines"} a signed form group through the real brain`, async ({
      page,
      auditCase,
    }) => {
      const templateId = randomUUID();
      const instanceId = randomUUID();
      const key = `controls-audit/${randomUUID()}.pdf`;
      const pdf = await PDFDocument.create();
      pdf
        .getForm()
        .createTextField("name")
        .addToPage(pdf.addPage([400, 600]), { x: 20, y: 500, width: 160, height: 25 });
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
      await database.sql`INSERT INTO form_template (id, publisher, title, source, hash, format, pages, schema, storage_key)
        VALUES (${templateId}, 'Audit fixture', 'Verwaltungsformular', 'https://example.org/form.pdf', ${"0".repeat(64)}, 'acroform', 1, ${JSON.stringify(schema)}::jsonb, ${key})`;
      await database.sql`INSERT INTO form_instance (id, case_id, subject_id, template_id, fields)
        VALUES (${instanceId}, ${auditCase.id}, ${auditCase.subjectId}, ${templateId}, '{}'::jsonb)`;
      try {
        expect(
          (
            await page.request.patch(`/api/forms/instances/${instanceId}`, {
              data: { fieldId: "name", value: "Ada" },
            })
          ).ok(),
        ).toBe(true);
        const approvalId = await seedApproval(page, auditCase.id, "form.commitGroup", {
          formInstanceId: instanceId,
          fieldIds: ["name"],
          values: { name: "Ada" },
        });
        await page.goto("/workspace");
        const label = approved ? "Zustimmen" : "Ablehnen";
        if (approved) {
          await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
          const settings = page.locator("header details");
          await settings.locator("summary").click();
          await settings.getByRole("button", { name: "Neue Sitzung", exact: true }).click();
          await expect(settings.getByRole("status")).toHaveText("Neue Sitzung gestartet.");
        }
        await page.getByRole("button", { name: label, exact: true }).click();
        await expect
          .poll(async () => {
            const [row] = await database.db
              .select()
              .from(approvals)
              .where(eq(approvals.approvalId, approvalId));
            return row?.decision;
          })
          .toBe(approved ? "approved" : "denied");
        await expect
          .poll(async () => {
            const [row] =
              await database.sql`SELECT fields->'name'->>'state' AS state FROM form_instance WHERE id = ${instanceId}`;
            return row?.state;
          })
          .toBe(approved ? "confirmed" : "draft");
        await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      } finally {
        await database.sql`DELETE FROM form_instance WHERE id = ${instanceId}`;
        await database.sql`DELETE FROM form_template WHERE id = ${templateId}`;
        await storage.delete(key);
      }
    });
  }
}
