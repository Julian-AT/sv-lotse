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

test("@workspace FR-K1 FR-D9 FR-O2 FR-O3 use persisted context, sourced offers and downloadable drafts", async ({
  page,
  context,
  playwright,
}, testInfo) => {
  await page.goto("/");
  const identity = identitySchema.parse(await (await context.request.post("/api/session")).json());
  // Constructed administrative state, persisted in Postgres.
  await database.db.insert(subjects).values({
    id: subjectId,
    createdBy: identity.userId,
    displayName: "Testperson",
    relationToUser: "self",
  });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "Unterlagen für Beratung vorbereiten" });
  await database.db.insert(caseSteps).values({
    id: stepId,
    caseId,
    processStep: "Unterlagen sammeln",
    status: "in_progress",
    owner: "user",
    initiatedBy: "pilot",
  });
  await database.db.insert(documents).values({
    subjectId,
    type: "test-present",
    storageKey: randomUUID(),
    hash: "test-hash",
    originClient: "web",
    ocrStatus: "completed",
  });
  await database.db.insert(benefits).values({
    key: benefitKey,
    title: "Beratung vorbereiten",
    category: "A",
    record: {
      id: benefitKey,
      name_de: "Beratung vorbereiten",
      documents: [
        {
          id: "test-present",
          name_de: "Vorliegende Unterlage",
          required: true,
          obtain_from: "Ausstellende Stelle",
          source,
        },
        {
          id: "test-needed",
          name_de: "Benötigte Unterlage",
          required: true,
          obtain_from: "Ausstellende Stelle",
          source,
        },
      ],
    },
  });
  await database.db.insert(facilities).values({
    key: facilityKey,
    title: "FSW Beratung und Service-Center",
    type: "Pflegeberatung",
    record: {
      id: facilityKey,
      name_de: "FSW Beratung und Service-Center",
      type: "Pflegeberatung",
      address: { street: "Guglgasse 7–9", postal_code: "1030", locality: "Wien" },
      location: { latitude: 48.1861406, longitude: 16.417604 },
      phone: "01 24 5 24",
      url: source.url,
      opening_hours: "Mo–Fr 8:00–15:00 Uhr",
      sources: [source],
      as_of: "2026-11-06",
    },
  });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`/cases?caseId=${caseId}`);
  await expect(
    page.getByRole("heading", { name: "Unterlagen für Beratung vorbereiten" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Weg ansehen" }).click();
  await expect(page.getByRole("heading", { name: "Unterlagen sammeln" })).toBeVisible();
  await expect(page.getByText("In Arbeit", { exact: true })).toBeVisible();
  await database.db.update(caseSteps).set({ status: "completed" }).where(eq(caseSteps.id, stepId));
  await page.reload();
  await expect(page.getByText("Erledigt", { exact: true })).toBeVisible();
  await page.goto(`/documents?caseId=${caseId}&benefitId=${benefitKey}`);
  await expect(page.getByText("Vorhanden", { exact: true })).toBeVisible();
  await expect(page.getByText("Erhältlich", { exact: true })).toBeVisible();
  await expect(page.getByText("Ausstellende Stelle", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("navigation", { name: "Arbeitsbereich" })
    .getByRole("link", { name: "Angebote & Einrichtungen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "FSW Beratung und Service-Center", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Karte laden" })).toBeVisible();
  await page.getByRole("button", { name: "Karte laden" }).click();
  await expect(page.getByRole("region", { name: "Karte der Einrichtungen" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "FSW Beratung und Service-Center", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Termin vorbereiten", exact: true }).click();
  await page.getByRole("button", { name: "Entwürfe vorbereiten" }).click();
  await expect(
    page.getByRole("textbox", { name: "Spickzettel für den Anruf", exact: true }),
  ).toHaveValue(/Unterlagen für Beratung vorbereiten/);
  await expect(page.getByRole("textbox", { name: "E-Mail-Entwurf", exact: true })).toHaveValue(
    /mögliche Termine/,
  );
  await expect(
    page.getByRole("textbox", { name: "Spickzettel für den Anruf", exact: true }),
  ).toHaveValue(/Benötigte Unterlage/);
  await page.getByLabel("Beginn (Ihre Ortszeit)").fill("2026-11-09T09:00");
  await page.getByLabel("Ende (Ihre Ortszeit)").fill("2026-11-09T09:30");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: ".ics herunterladen" }).click();
  const download = await downloadEvent;
  const path = testInfo.outputPath("appointment.ics");
  await download.saveAs(path);
  expect(await readFile(path, "utf8")).toContain("STATUS:TENTATIVE");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("appointments.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const outsider = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect((await outsider.get(`/api/workspace?caseId=${caseId}`)).status()).toBe(401);
    await outsider.post("/api/session");
    expect((await outsider.get(`/api/workspace?caseId=${caseId}`)).status()).toBe(403);
  } finally {
    await outsider.dispose();
  }
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
    await page.locator('input[type="file"]').setInputFiles({
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
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace$/);
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
