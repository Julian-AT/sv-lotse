import { randomUUID } from "node:crypto";
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

function stream(parts: unknown[]): string {
  return `${parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("")}data: [DONE]\n\n`;
}

test("FR-D5 recorded tools fill beside chat, confirm, stop and save corrections @form-stream", async ({
  page,
  context,
}) => {
  // Constructed administrative fixture: real Postgres, MinIO, PDF.js and HTTP.
  // Only the model's UI stream is recorded; no provider calls are made.
  const subjectId = randomUUID();
  const caseId = randomUUID();
  const templateId = randomUUID();
  const instanceId = randomUUID();
  const approvalId = randomUUID();
  const messageId = randomUUID();
  const key = `form-stream/${randomUUID()}.pdf`;
  const provenance = {
    source: { kind: "statement", quote: "Mein Name ist Ada Muster.", turnId: randomUUID() },
  };
  const value = "Ada Muster";
  const fields = { name: { value, provenance, state: "draft", approvalId: null } };
  let userId: string | undefined;
  let requests = 0;
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]).drawText("Name", { x: 20, y: 550 });
    await storage.put(key, await pdf.save(), "application/pdf");
    userId = z
      .object({ userId: z.uuid() })
      .parse(await (await context.request.post("/api/session")).json()).userId;
    await database.sql`INSERT INTO subject (id, display_name, relation_to_user, created_by) VALUES (${subjectId}, 'Testperson', 'self', ${userId})`;
    await database.sql`INSERT INTO "case" (id, subject_id, confirmed_goal) VALUES (${caseId}, ${subjectId}, 'Formular vorbereiten')`;
    const schema = {
      fields: [
        {
          id: "name",
          label_de: "Name",
          type: "text",
          owner: "applicant",
          signature: "none",
          fact_type: "administrative.statement",
          box: { page: 1, x: 20, y: 70, width: 180, height: 28 },
          validation: { required: true },
        },
      ],
    };
    await database.sql`INSERT INTO form_template (id, publisher, title, source, hash, format, pages, schema, storage_key) VALUES (${templateId}, 'Test', 'Testformular', 'https://example.org/form.pdf', ${"0".repeat(64)}, 'flat', 1, ${JSON.stringify(schema)}::jsonb, ${key})`;
    await database.sql`INSERT INTO form_instance (id, case_id, subject_id, template_id, fields) VALUES (${instanceId}, ${caseId}, ${subjectId}, ${templateId}, ${JSON.stringify(fields)}::jsonb)`;
    await page.addInitScript(() => {
      const messages: unknown[] = [];
      Reflect.set(window, "nativeFormMessages", messages);
      window.webkit = {
        messageHandlers: {
          lotse: {
            postMessage: async (message) => {
              messages.push(message);
              return { accepted: true };
            },
          },
        },
      };
    });
    await page.route("**/api/turn", async (route) => {
      requests++;
      const action = {
        type: "data-action",
        data: {
          id: randomUUID(),
          kind: "type",
          sentenceIndex: 0,
          target: { kind: "form", formInstanceId: instanceId, fieldId: "name" },
          payload: { value, pace: 400, provenance },
        },
      };
      let parts: unknown[];
      if (requests === 1) {
        parts = [
          { type: "start", messageId },
          { type: "start-step" },
          {
            type: "tool-input-available",
            toolCallId: "prefill",
            toolName: "form.prefill",
            input: {},
          },
          {
            type: "tool-output-available",
            toolCallId: "prefill",
            output: { formInstanceId: instanceId },
          },
          {
            type: "data-action",
            data: {
              id: "workspace-highlight",
              kind: "highlight",
              sentenceIndex: 0,
              target: { kind: "ui", elementId: "workspace-message" },
              payload: {},
            },
          },
          action,
          {
            type: "data-approval-context",
            data: {
              approvalId,
              caseId,
              toolCallId: "commit",
              toolName: "form.commitGroup",
              summary: "Bitte prüfen Sie die Angaben.",
              inputHash: "0".repeat(64),
              provenance: [provenance],
            },
          },
          { type: "tool-input-start", toolCallId: "commit", toolName: "form.commitGroup" },
          {
            type: "tool-input-delta",
            toolCallId: "commit",
            inputTextDelta: JSON.stringify({
              formInstanceId: instanceId,
              fieldIds: ["name"],
              values: { name: value },
            }),
          },
          { type: "tool-approval-request", toolCallId: "commit", approvalId },
          { type: "finish-step" },
          { type: "finish" },
        ];
      } else if (requests === 2) {
        expect(route.request().postDataJSON()).toMatchObject({
          message: {
            role: "assistant",
            parts: expect.arrayContaining([
              expect.objectContaining({
                state: "approval-responded",
                approval: expect.objectContaining({ id: approvalId, approved: true }),
              }),
            ]),
          },
        });
        const confirmed = { name: { ...fields.name, state: "confirmed", approvalId } };
        await database.sql`UPDATE form_instance SET fields = ${JSON.stringify(confirmed)}::jsonb WHERE id = ${instanceId}`;
        parts = [
          { type: "start", messageId },
          { type: "start-step" },
          {
            type: "tool-output-available",
            toolCallId: "commit",
            output: { values: { name: value }, approvalId },
          },
          { type: "finish-step" },
          { type: "start-step" },
          { type: "text-start", id: "done" },
          { type: "text-delta", id: "done", delta: "Die Feldgruppe ist bestätigt." },
          { type: "text-end", id: "done" },
          { type: "finish-step" },
          { type: "finish" },
        ];
      } else {
        parts = [
          { type: "start", messageId: randomUUID() },
          { type: "start-step" },
          action,
          { type: "text-start", id: "fill" },
          { type: "text-delta", id: "fill", delta: "Die Angabe wird gezeigt." },
          { type: "text-end", id: "fill" },
          { type: "finish-step" },
          { type: "finish" },
        ];
      }
      await route.fulfill({
        contentType: "text/event-stream",
        headers: { "x-vercel-ai-ui-message-stream": "v1", "x-lotse-case-id": caseId },
        body: stream(parts),
      });
    });
    await page.goto("/workspace");
    const chat = page.locator('section[aria-labelledby="conversation-title"]');
    const composer = page.locator("#workspace-message");
    await composer.fill("Bitte Formular vorbereiten.");
    await page.getByRole("button", { name: "Senden", exact: true }).first().click();
    const viewer = page.getByRole("region", { name: "Formular", exact: true });
    await expect(viewer.getByRole("heading", { name: "Testformular" })).toBeVisible();
    await expect(viewer.locator('[data-active="true"]')).toBeVisible();
    await expect(viewer.locator('p[role="status"]').first()).toContainText(value);
    await expect(viewer.locator('p[role="status"]').first()).toContainText(provenance.source.quote);
    await expect(viewer.getByRole("button", { name: "Zustimmen", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Zustimmen", exact: true })).toHaveCount(2);
    await expect(viewer.locator('[data-active="true"]')).toHaveCount(0);
    await expect(chat.getByText(`Name: ${value}`, { exact: true })).toBeVisible();
    await chat.getByRole("button", { name: "Zustimmen", exact: true }).click();
    await expect(
      viewer.getByLabel("Formularfelder").getByText("Bestätigt", { exact: true }),
    ).toBeVisible();
    for (const stop of ["click", "key"]) {
      await composer.fill("Angabe nochmals zeigen.");
      await page.getByRole("button", { name: "Senden", exact: true }).first().click();
      await expect(viewer.locator('[data-active="true"]')).toBeVisible();
      if (stop === "click")
        await viewer.getByRole("button", { name: "Ausfüllen stoppen (Esc)" }).click();
      else await page.keyboard.press("Escape");
      await expect(viewer.locator('[data-active="true"]')).toHaveCount(0);
      await expect(viewer.locator('p[role="status"]').first()).toHaveText("Ausfüllen gestoppt.");
    }
    await viewer.getByRole("button", { name: "Korrigieren: Name" }).first().click();
    await viewer.getByLabel("Name", { exact: true }).fill("Ada Neu");
    await viewer.getByRole("button", { name: "Korrektur speichern" }).click();
    await expect(
      viewer.getByLabel("Formularfelder").getByText("Ada Neu", { exact: true }).first(),
    ).toBeVisible();
    const [fact] =
      await database.sql`SELECT confirmed, source FROM fact WHERE subject_id = ${subjectId}`;
    expect(fact).toMatchObject({
      confirmed: true,
      source: { kind: "statement", quote: "Ada Neu" },
    });
    expect(
      await page.evaluate(() =>
        (Reflect.get(window, "nativeFormMessages") as { type: string }[]).filter(
          (message) => message.type === "Action",
        ),
      ),
    ).toEqual([]);
    expect(requests).toBe(4);
    for (const surface of ["documents", "journey"]) {
      await page.goto(`/${surface}?caseId=${caseId}`);
      await expect(
        page.getByRole("link", { name: "Formular öffnen", exact: true }),
      ).toHaveAttribute("href", `/forms/${instanceId}`);
    }
  } finally {
    await database.sql`DELETE FROM subject WHERE id = ${subjectId}`;
    await database.sql`DELETE FROM form_template WHERE id = ${templateId}`;
    if (userId) await database.sql`DELETE FROM "user" WHERE id = ${userId}`;
    await storage.delete(key);
  }
});
