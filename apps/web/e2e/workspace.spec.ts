import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { createDatabase } from "@lotse/db";
import {
  benefits,
  caseSteps,
  cases,
  documents,
  facilities,
  facts,
  messages,
  subjects,
  users,
} from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { PROTOCOL_VERSION } from "@lotse/protocol";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

const database = createDatabase();
const storage = createObjectStorage();
const identitySchema = z.object({ userId: z.uuid() });
const subjectId = randomUUID();
const caseId = randomUUID();
const benefitKey = `test-benefit-${randomUUID()}`;
const facilityKey = `test-facility-${randomUUID()}`;
const stepId = randomUUID();
const source = {
  url: "https://www.fsw.at/standorte",
  quote: "Guglgasse 7–9",
  retrieved_at: "2026-11-06T01:35:29Z",
};

test.afterAll(async () => {
  await database.db.delete(subjects).where(eq(subjects.id, subjectId));
  await database.db.delete(benefits).where(eq(benefits.key, benefitKey));
  await database.db.delete(facilities).where(eq(facilities.key, facilityKey));
  await database.close();
  storage.close();
});

test("§6 workspace persists case selection, reviews facts and uploads actual documents", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(page.getByRole("button", { name: "Neues Anliegen", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Neues Anliegen", exact: true }).click();
  await expect(page.getByLabel("Ihre Nachricht")).toBeVisible();
  const identity = (await (await page.request.post("/api/session")).json()) as { userId: string };
  const result = (await (await page.request.get("/api/cases?view=workspace")).json()) as {
    cases: { id: string; subjectId: string }[];
  };
  const selected = result.cases[0];
  if (!selected) throw new Error("CASE_MISSING");
  try {
    const documentId = randomUUID();
    const messageId = randomUUID();
    // Test-only quoted administrative fixture; no medical claim or real user's content.
    await database.db.insert(documents).values({
      id: documentId,
      subjectId: selected.subjectId,
      type: "application/pdf",
      storageKey: randomUUID(),
      hash: "test-fixture",
      originClient: "web",
    });
    await database.db.insert(facts).values({
      subjectId: selected.subjectId,
      type: "Administrative quote",
      value: "Antrag per Post",
      confirmed: true,
      documentId,
      source: { kind: "document", documentId, page: 1, quote: "Antrag per Post" },
      confidence: 1,
    });
    await database.db.insert(messages).values({
      caseId: selected.id,
      position: 0,
      uiMessage: {
        id: messageId,
        role: "assistant",
        parts: [
          { type: "text", text: "Wir können die Verwaltungsunterlagen gemeinsam prüfen." },
          {
            type: "data-speech-segment",
            data: {
              turnId: randomUUID(),
              index: 0,
              text: "Wir können die Verwaltungsunterlagen gemeinsam prüfen.",
              language: "de",
              citations: [
                {
                  passageId: "source-fixture",
                  url: "https://www.sozialversicherung.at/",
                  quote: "Administrative source fixture",
                },
              ],
              actionIds: [],
            },
          },
        ],
      },
    });
    await page.reload();
    await expect(
      page.getByText("Wir können die Verwaltungsunterlagen gemeinsam prüfen.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Warum?" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "www.sozialversicherung.at" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Bestätigt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await page.getByLabel("Angabe bearbeiten").fill("Antrag persönlich");
    await page.getByRole("button", { name: "Änderung speichern", exact: true }).click();
    await expect(page.getByText("Antrag persönlich", { exact: true })).toBeVisible();
    await expect(page.getByText("Bestätigt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
    await expect(page.getByText("Noch keine Angaben zum Prüfen.")).toBeVisible();
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Datum: 06.11.2026. Institution: Oesterreichische Gesundheitskasse.");
    const uploadBytes = Buffer.from(await pdf.save());
    await page.locator('[data-testid="document-input"]').setInputFiles({
      name: "administrative.pdf",
      mimeType: "application/pdf",
      buffer: uploadBytes,
    });
    const preview = page.getByRole("dialog", { name: "Dokument vor dem Speichern prüfen" });
    await expect(preview.getByText("administrative.pdf", { exact: true })).toBeVisible();
    await preview.getByRole("button", { name: "Dokument speichern", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Dokument gespeichert");
    const stored = await database.db
      .select()
      .from(documents)
      .where(eq(documents.subjectId, selected.subjectId));
    const actual = stored.find((document) => document.id !== documentId);
    if (!actual) throw new Error("UPLOAD_MISSING");
    const downloaded = await page.request.get(
      `/api/documents/${actual.id}?subjectId=${selected.subjectId}`,
    );
    expect(downloaded.ok()).toBe(true);
    expect(await downloaded.body()).toEqual(uploadBytes);
    await page.getByRole("button", { name: "Bestätigen", exact: true }).first().click();
    await expect(page.getByText("Bestätigt", { exact: true }).first()).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: "/tmp/lotse-workspace.png", fullPage: true });
  } finally {
    const uploaded = await database.db
      .select()
      .from(documents)
      .where(eq(documents.subjectId, selected.subjectId));
    for (const document of uploaded) await storage.delete(document.storageKey);
    await database.db.delete(users).where(eq(users.id, identity.userId));
  }
});

test("§9 embedded workspace accepts native handshake and final transcript without a second conversation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      webkit: { messageHandlers: { lotse: { postMessage: async () => undefined } } },
    });
  });
  await page.goto("/workspace");
  await expect(page.getByLabel("Ihre Nachricht")).toBeVisible();
  await page.evaluate(
    async ({ version }) => {
      await window.__lotse?.receive({
        v: version,
        type: "BridgeHello",
        id: "native-hello",
        payload: {
          appVersion: "0.0.0",
          protocolVersion: version,
          capabilities: {
            overlay: true,
            accessibility: true,
            ocr: true,
            onDeviceModel: false,
            onDeviceContextSize: 0,
          },
        },
      });
      await window.__lotse?.receive({
        v: version,
        type: "Transcript",
        id: "partial",
        payload: { text: "Bitte helfen", final: false },
      });
    },
    { version: PROTOCOL_VERSION },
  );
  await expect(page.getByLabel("Spracheingabe")).toHaveText("Bitte helfen");
  const sent = page.waitForRequest(
    (request) => request.url().endsWith("/api/turn") && request.method() === "POST",
  );
  await page.evaluate(
    async ({ version }) => {
      await window.__lotse?.receive({
        v: version,
        type: "Transcript",
        id: "final",
        payload: {
          text: "Bitte bestätigen Sie kurz, dass Sie bei Verwaltungsfragen helfen können.",
          final: true,
          language: "de",
          capsule: {},
        },
      });
    },
    { version: PROTOCOL_VERSION },
  );
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  expect(body).not.toHaveProperty("messages");
  expect(body).toMatchObject({
    inputKind: "transcript",
    language: "de",
    capsule: {},
    clientHello: { clientKind: "mac" },
    message: { role: "user" },
  });
  await expect(page.locator('[data-speaker="assistant"]')).toBeVisible();
  await expect(
    page.getByText("Das hat nicht geklappt. Bitte versuchen Sie es erneut."),
  ).toHaveCount(0);
  const identity = (await (await page.request.post("/api/session")).json()) as { userId: string };
  await database.db.delete(users).where(eq(users.id, identity.userId));
});
