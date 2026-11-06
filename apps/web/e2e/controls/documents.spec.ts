import { randomUUID } from "node:crypto";
import { benefits, documents, facts } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { database, expect, storage, test } from "./fixtures.ts";

test("upload, confirm, edit, cancel and reject facts, then open and page through the original document", async ({
  page,
  auditCase,
}) => {
  await page.goto("/workspace");
  await expect(page.locator("#workspace-message")).toBeVisible();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Datum: 06.11.2026. Institution: Oesterreichische Gesundheitskasse.");
  pdf.addPage().drawText("Bitte bringen Sie Ihre Unterlagen zum Beratungstermin mit.");
  const upload = {
    name: "administrative-audit.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  };
  const chooserEvent = page.waitForEvent("filechooser");
  const extractionEvent = page.waitForResponse(
    (response) => response.url().endsWith("/extract") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Dokument hochladen", exact: true }).click();
  await (await chooserEvent).setFiles(upload);
  const preview = page.getByRole("dialog", { name: "Dokument vor dem Speichern prüfen" });
  await expect(preview.getByText("2 Seiten", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Dokument speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dokument gespeichert" })).toBeVisible();
  const [stored] = await database.db
    .select()
    .from(documents)
    .where(eq(documents.subjectId, auditCase.subjectId));
  if (!stored) throw new Error("AUDIT_DOCUMENT_MISSING");
  try {
    const extraction = await extractionEvent;
    if (!extraction.ok()) {
      const review = page.getByRole("region", { name: "Angaben prüfen", exact: true });
      await expect(review.getByRole("alert")).toBeVisible();
      const retried = page.waitForResponse(
        (response) => response.url().endsWith("/extract") && response.request().method() === "POST",
      );
      await review.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
      expect((await retried).status(), "The real extraction provider must be available").toBe(200);
    }
    const confirm = page.getByRole("button", { name: "Bestätigen", exact: true }).first();
    await confirm.click();
    const confirmed = page
      .locator('div[id^="fact-"]')
      .filter({ has: page.getByText("Bestätigt", { exact: true }) })
      .first();
    await expect(confirmed).toBeVisible();
    await confirmed.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await confirmed.getByLabel("Angabe bearbeiten").fill("Nicht speichern");
    await confirmed.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(confirmed.getByLabel("Angabe bearbeiten")).toHaveCount(0);
    await confirmed.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await confirmed.getByLabel("Angabe bearbeiten").fill("Antrag persönlich abgeben");
    await confirmed.getByRole("button", { name: "Änderung speichern", exact: true }).click();
    await expect(
      page.locator(".lotse-decision p").filter({ hasText: /^Antrag persönlich abgeben$/ }),
    ).toBeVisible();
    await confirmed.getByRole("button", { name: "Verwerfen", exact: true }).click();
    await expect(page.getByText("Antrag persönlich abgeben", { exact: true })).toHaveCount(0);
    const rejects = page.getByRole("button", { name: "Verwerfen", exact: true });
    while (await rejects.count()) await rejects.first().click();
    await page.goto(`/documents?caseId=${auditCase.id}`);
    const catalog = await database.db.select().from(benefits);
    const benefit = catalog.find((record) => {
      const value = record.record;
      return (
        typeof value === "object" &&
        value !== null &&
        "documents" in value &&
        Array.isArray(value.documents) &&
        value.documents.length > 0
      );
    });
    if (!benefit) throw new Error("SOURCED_CHECKLIST_REQUIRED");
    await page.getByLabel("Leistung für die Unterlagenliste").selectOption(benefit.key);
    await expect(page).toHaveURL(new RegExp(`benefitId=${encodeURIComponent(benefit.key)}`));
    await page.locator("details summary").filter({ hasText: "Quelle:" }).first().click();
    await expect(page.locator("details[open] blockquote").first()).toBeVisible();
    await page.getByRole("button", { name: "Dokument ansehen", exact: true }).click();
    const viewer = page.getByRole("region", { name: "Originaldokument", exact: true });
    await expect(viewer.locator("canvas")).toBeVisible();
    await viewer.getByRole("button", { name: "Nächste Seite", exact: true }).click();
    await expect(viewer).toContainText("Seite 2 / 2");
    await viewer.getByRole("button", { name: "Vorherige Seite", exact: true }).click();
    await expect(viewer).toContainText("Seite 1 / 2");
    await viewer.getByRole("button", { name: "Dokument schließen", exact: true }).click();
    await expect(viewer).toHaveCount(0);
  } finally {
    await storage.delete(stored.storageKey);
  }
});

test("stored documents show sourced checklists, original PDF pages and editable existing facts without a model call", async ({
  page,
  auditCase,
}) => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Antrag per Post. Bitte legen Sie die Verwaltungsunterlagen bei.");
  pdf.addPage().drawText("Unterlagen fuer den Beratungstermin. Bitte bringen Sie den Antrag mit.");
  const bytes = Buffer.from(await pdf.save());
  const response = await page.request.post("/api/documents", {
    multipart: {
      subjectId: auditCase.subjectId,
      originClient: "web",
      file: { name: "administrative.pdf", mimeType: "application/pdf", buffer: bytes },
    },
  });
  expect(response.ok()).toBe(true);
  const { documentId } = z.object({ documentId: z.uuid() }).parse(await response.json());
  const [document] = await database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) throw new Error("AUDIT_DOCUMENT_MISSING");
  try {
    // An existing confirmed, quoted fact is a test fixture. Upload/storage/rendering are real.
    await database.db.insert(facts).values({
      id: randomUUID(),
      subjectId: auditCase.subjectId,
      documentId,
      type: "administrative.statement",
      value: "Antrag per Post",
      confirmed: true,
      confidence: 1,
      source: { kind: "document", documentId, page: 1, quote: "Antrag per Post" },
    });
    await page.goto("/workspace");
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await page.getByLabel("Angabe bearbeiten").fill("Nicht speichern");
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(
      page.locator(".lotse-decision p").filter({ hasText: /^Antrag per Post$/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await page.getByLabel("Angabe bearbeiten").fill("Antrag persönlich");
    await page.getByRole("button", { name: "Änderung speichern", exact: true }).click();
    await expect(
      page.locator(".lotse-decision p").filter({ hasText: /^Antrag persönlich$/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
    await expect(page.getByText("Noch keine Angaben zum Prüfen.", { exact: true })).toBeVisible();
    await page.goto(`/documents?caseId=${auditCase.id}`);
    await page.getByRole("button", { name: "Dokument ansehen", exact: true }).click();
    const viewer = page.getByRole("region", { name: "Originaldokument", exact: true });
    await expect(viewer.locator("canvas")).toBeVisible();
    await viewer.getByRole("button", { name: "Nächste Seite", exact: true }).click();
    await expect(viewer).toContainText("Seite 2 / 2");
    await viewer.getByRole("button", { name: "Vorherige Seite", exact: true }).click();
    await expect(viewer).toContainText("Seite 1 / 2");
    await viewer.getByRole("button", { name: "Dokument schließen", exact: true }).click();
    await expect(viewer).toHaveCount(0);
    const catalog = await database.db.select().from(benefits);
    const benefit = catalog.find(
      (entry) =>
        typeof entry.record === "object" &&
        entry.record !== null &&
        "documents" in entry.record &&
        Array.isArray(entry.record.documents) &&
        entry.record.documents.length > 0,
    );
    if (!benefit) throw new Error("SOURCED_CHECKLIST_REQUIRED");
    await page.getByLabel("Leistung für die Unterlagenliste").selectOption(benefit.key);
    await page.locator("details summary").filter({ hasText: "Quelle:" }).first().click();
    await expect(page.locator("details[open] blockquote").first()).toBeVisible();
  } finally {
    await storage.delete(document.storageKey);
  }
});
