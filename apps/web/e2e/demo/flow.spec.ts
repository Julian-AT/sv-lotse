import { readFile } from "node:fs/promises";
import { createDatabase } from "@lotse/db";
import {
  approvals,
  caseSteps,
  cases,
  documents,
  formFields,
  formInstances,
  subjects,
  turns,
  users,
} from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { demoAsset, loadDemoManifest } from "../../../../scripts/demo/config.ts";
import { DEMO_E2E } from "./config.ts";
import { confirmSubstepIfAsked, outputs, requireTool, say } from "./helpers.ts";

const database = createDatabase();
const storage = createObjectStorage();
const createdCaseSchema = z.object({ case: z.object({ id: z.uuid(), subjectId: z.uuid() }) });
const proposalSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  value: z.string(),
  source: z.object({ page: z.int(), quote: z.string() }),
});

const extractionSchema = z.object({ proposals: z.array(proposalSchema) });
const instanceSchema = z.object({ formInstanceId: z.uuid() });
const facilitySchema = z
  .array(z.object({ id: z.string(), title: z.string(), sources: z.array(z.unknown()).min(1) }))
  .min(1);

test.afterAll(async () => {
  storage.close();
  await database.close();
});

test("@demo @live Scenario 3 imports the original, confirms the goal and prepares the next administrative step", async ({
  page,
}, testInfo) => {
  const manifest = await loadDemoManifest();
  let userId: string | undefined;
  let subjectId: string | undefined;
  let selectedBenefitId = "";
  let responsibilityStepId = "";
  let selectedFacilityId = "";
  const browserErrors: string[] = [];
  page.on("pageerror", () => browserErrors.push("BROWSER_RUNTIME_ERROR"));
  try {
    await test.step("Create a real anonymous case and explicitly enable preparation", async () => {
      await page.goto("/workspace");
      const identity = z
        .object({ userId: z.uuid() })
        .parse(await (await page.request.post("/api/session")).json());
      userId = identity.userId;
      expect(
        (
          await page.request.patch("/api/preferences", {
            data: { autonomyLevel: "L2", language: "de" },
          })
        ).ok(),
      ).toBe(true);
      await page.reload();
    });
    const created = page.waitForResponse(
      (response) => response.url().endsWith("/api/cases") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Neues Anliegen", exact: true }).click();
    const selected = createdCaseSchema.parse(await (await created).json()).case;
    subjectId = selected.subjectId;
    const caseId = selected.id;
    // A fresh case contains no scripted assistant messages, steps, facts or tool outputs.
    expect(
      await database.db.select().from(caseSteps).where(eq(caseSteps.caseId, caseId)),
    ).toHaveLength(0);

    await test.step("Upload the untouched SV-Box PDF through the real extraction pipeline", async () => {
      const extracted = page.waitForResponse(
        (response) => /\/api\/documents\/[^/]+\/extract$/.test(response.url()),
        { timeout: DEMO_E2E.extractionTimeoutMs },
      );
      await page
        .locator('[data-testid="document-input"]')
        .setInputFiles(demoAsset(manifest.document));
      await page
        .getByRole("dialog", { name: "Dokument vor dem Speichern prüfen" })
        .getByRole("button", { name: "Dokument speichern", exact: true })
        .click();
      const response = await extracted;
      expect(response.ok(), "Live OpenAI statement extraction succeeds").toBe(true);
      const result = extractionSchema.parse(await response.json());
      const recommendation = result.proposals.find(
        (proposal) =>
          proposal.type === "documented_recommendation" && /rehabilitation/iu.test(proposal.value),
      );
      expect(
        recommendation,
        "The original contains an explicit rehabilitation recommendation",
      ).toBeDefined();
      if (!recommendation) throw new Error("RECOMMENDATION_MISSING");
      expect(recommendation.value).toBe(recommendation.source.quote);
      const card = page.locator(`[id="fact-${recommendation.id}"]`);
      await card.getByText("Im Dokument anzeigen", { exact: true }).click();
      await expect(card.locator("figure")).not.toHaveAttribute("data-error-stage", /.+/);
      await expect(card.locator("mark")).toBeVisible();
      await expect(card.locator("mark")).toHaveAttribute("title", recommendation.source.quote);
      await card.screenshot({ path: testInfo.outputPath("recommendation.png") });
      await card.getByRole("button", { name: "Bestätigen", exact: true }).click();
    });

    await test.step("Explicitly confirm rehabilitation as the goal and resolve the sourced office", async () => {
      await say(
        page,
        "Ich möchte den Antrag auf medizinische Rehabilitation gemeinsam vorbereiten.",
      );
      const [before] = await database.db.select().from(cases).where(eq(cases.id, caseId));
      expect(before?.confirmedGoal).toBe("");
      await expect(page.locator('[data-speaker="assistant"]').last()).toContainText(
        "Ist das Ihr Ziel?",
      );
      await say(page, "Ja, genau das ist mein Ziel.");
      await expect
        .poll(async () => {
          const [record] = await database.db.select().from(cases).where(eq(cases.id, caseId));
          return record?.confirmedGoal;
        })
        .toMatch(/Reha/iu);
      await say(
        page,
        "Bitte suchen Sie die Leistung für medizinische Rehabilitation im Katalog ohne lifeSituation-Filter. Ich möchte die passende Leistung aus dem tatsächlichen Ergebnis auswählen.",
      );
      const found = z
        .array(z.object({ id: z.string(), title: z.string() }))
        .min(1)
        .parse(await requireTool(page, caseId, "catalog.findBenefits"));
      const selectedBenefit = found.find((benefit) =>
        /medizinische rehabilitation/iu.test(benefit.title),
      );
      if (!selectedBenefit) throw new Error("CATALOG_SELECTION_MISSING");
      selectedBenefitId = selectedBenefit.id;
      // Select an actual returned record, never a scripted benefit identifier.
      await say(
        page,
        `Ich wähle „${selectedBenefit.title}“ (Katalogkennung ${selectedBenefit.id}). Bitte starten Sie dafür process.start. Ich bin in Pension, meine Pension kommt von der PVA, ich wohne in Wien. Das Krankenhaus hat kein Anschlussheilverfahren beantragt. Bitte speichern Sie diese Antworten und ermitteln Sie die zuständige Stelle für diesen Reha-Antrag.`,
      );
      const started = z
        .object({ steps: z.array(z.object({ id: z.uuid() })).min(1) })
        .parse(await requireTool(page, caseId, "process.start"));
      responsibilityStepId = started.steps[0]?.id ?? "";
      if ((await outputs(page, caseId, "office.resolve")).length === 0) {
        await say(
          page,
          `Bitte ermitteln Sie jetzt ausschließlich den Verwaltungskontakt mit office.resolve für benefitId ${selectedBenefit.id}, carrier PVA, subjectStatus pensioner:PVA und region Wien. Diese Angaben sind meine eigenen Antworten. Keine Prüfung medizinischer Voraussetzungen.`,
        );
      }
      const office = z
        .object({ title: z.string(), sources: z.array(z.unknown()).min(1) })
        .parse(await requireTool(page, caseId, "office.resolve"));
      expect(office.title).toMatch(/Wien/iu);
      const contact = page
        .getByRole("region", { name: "Zuständige Anlaufstelle", exact: true })
        .last();
      await expect(contact.getByRole("heading", { name: office.title, exact: true })).toBeVisible();
      await contact.getByText("Quellen zur Anlaufstelle", { exact: true }).click();
      await expect(contact.locator("blockquote").first()).toBeVisible();
      const [after] = await database.db.select().from(cases).where(eq(cases.id, caseId));
      expect(after?.confirmedGoal).toMatch(/Reha/iu);
    });

    const instance =
      await test.step("Open the original rehabilitation form and supply one administrative field", async () => {
        await say(
          page,
          `Bitte suchen Sie das registrierte Formular „${manifest.form.title}“ mit form.find, lesen Sie sein Schema und legen Sie mit form.prefill einen Entwurf an. Suchen Sie ohne Trägerfilter, das gemeinsame Formular gilt für mehrere Träger. Medizinische Felder und Unterschriften bleiben leer. Ich möchte zunächst nur meinen Namen eintragen.`,
        );
        await confirmSubstepIfAsked(page, caseId, "form.prefill");
        const output = instanceSchema.parse(await requireTool(page, caseId, "form.prefill"));
        await expect(
          page.getByRole("heading", { name: manifest.form.title, exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Korrigieren: Patient(in)", exact: true })
          .first()
          .click();
        // This is the challenge's fictional person, explicitly entered by the user through the UI.
        await page
          .getByLabel("Patient(in)", { exact: true })
          .fill(manifest.displayName.replace(/ \(.*\)$/u, ""));
        await page.getByRole("button", { name: "Korrektur speichern", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Korrektur speichern", exact: true }),
        ).toHaveCount(0);
        return output.formInstanceId;
      });

    await test.step("Type the sourced value live and require approval before committing the group", async () => {
      const [storedDraft] = await database.db
        .select()
        .from(formInstances)
        .where(eq(formInstances.id, instance));
      const [nameFieldId] = Object.keys(formFields.parse(storedDraft?.fields));
      if (!nameFieldId) throw new Error("DRAFT_FIELD_MISSING");
      await say(
        page,
        `Bitte führen Sie jetzt ausschließlich form.fillLive aus: Formularentwurf ${instance}, fieldIds ["${nameFieldId}"]. Das ist das bereits gespeicherte Namensfeld Patient(in), mit meiner bestätigten Namensangabe als Quelle. Nur sichtbare Entwurfseingabe im geöffneten PDF, kein ui.fill und kein form.commitGroup in diesem Schritt.`,
      );
      await confirmSubstepIfAsked(page, caseId, "form.fillLive");
      const live = z
        .object({ actionIds: z.array(z.string()).min(1) })
        .parse(await requireTool(page, caseId, "form.fillLive"));
      const viewer = page.getByRole("region", { name: "Formular", exact: true });
      await expect(
        viewer.getByRole("status").filter({ hasText: "Wird eingetragen" }),
      ).toContainText("Wird eingetragen");
      await say(
        page,
        `Bitte fordern Sie jetzt mit form.commitGroup die Freigabe genau dieses Namensfelds und seines unveränderten Entwurfswerts an: formInstanceId ${instance}, fieldIds ["${nameFieldId}"]. Alle anderen Felder bleiben offen.`,
      );
      await confirmSubstepIfAsked(page, caseId, "form.commitGroup");
      const [draft] = await database.db
        .select()
        .from(formInstances)
        .where(eq(formInstances.id, instance));
      const fields = formFields.parse(draft?.fields);
      expect(Object.values(fields).some((field) => field.state === "draft")).toBe(true);
      expect(Object.values(fields).some((field) => field.state === "confirmed")).toBe(false);
      const [pending] = await database.db
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.caseId, caseId),
            eq(approvals.toolName, "form.commitGroup"),
            eq(approvals.decision, "pending"),
          ),
        );
      expect(pending, "A server-owned approval is pending").toBeDefined();
      const resumed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/turn") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Zustimmen", exact: true }).click();
      expect((await resumed).ok()).toBe(true);
      await requireTool(page, caseId, "form.commitGroup");
      const completedTurns = await database.db.select().from(turns).where(eq(turns.caseId, caseId));
      expect(
        completedTurns
          .flatMap((turn) => turn.actionResults)
          .some((result) => {
            const parsed = z
              .object({
                actionId: z.string(),
                success: z.literal(true),
                resolvedBy: z.literal("ui"),
              })
              .safeParse(result);
            return parsed.success && live.actionIds.includes(parsed.data.actionId);
          }),
        "The browser acknowledged the actual live field action",
      ).toBe(true);
      await expect
        .poll(async () => {
          const [row] = await database.db
            .select()
            .from(formInstances)
            .where(eq(formInstances.id, instance));
          return Object.values(formFields.parse(row?.fields)).filter(
            (field) => field.state === "confirmed" && field.approvalId,
          ).length;
        })
        .toBe(1);
      await page.screenshot({ path: testInfo.outputPath("approved-form.png"), fullPage: true });
    });

    await test.step("Prepare the checklist, sourced facility options and appointment drafts", async () => {
      await say(
        page,
        `Bitte erstellen Sie jetzt die Unterlagenliste mit documents.checklist für die gewählte Leistung ${selectedBenefitId} und meine betroffene Person ${subjectId}.`,
      );
      z.array(z.object({ whereToObtain: z.string().min(1), sources: z.array(z.unknown()).min(1) }))
        .min(1)
        .parse(await requireTool(page, caseId, "documents.checklist"));
      await say(
        page,
        "Bitte suchen Sie jetzt mit facility.search Rehabilitationseinrichtungen in Wien im Umkreis von 100 Kilometern. Die Auswahl dient nur der organisatorischen Kontaktaufnahme, nicht der medizinischen Eignung.",
      );
      const facilities = facilitySchema.parse(await requireTool(page, caseId, "facility.search"));
      const facility = facilities[0];
      if (!facility) throw new Error("FACILITY_MISSING");
      selectedFacilityId = facility.id;
      await say(
        page,
        `Bitte suchen Sie mit appointment.search Kontaktmöglichkeiten zur Einrichtung „${facility.title}“ mit facilityIds ["${facility.id}"]. Ich möchte in den nächsten vier Wochen vormittags anfragen, Ausgangsort Wien, maximal 100 km, Sprache Deutsch, keine zusätzlichen Zugänglichkeitswünsche. Ich werde selbst Kontakt aufnehmen; nichts versenden oder buchen.`,
      );
      await requireTool(page, caseId, "appointment.search");
      await say(
        page,
        "Ich wähle die erste tatsächlich zurückgegebene Kontaktoption. Bitte erstellen Sie jetzt mit appointment.prepare dafür einen Anruf-Spickzettel, einen E-Mail-Entwurf und eine Kalendervormerkung. Nur Entwürfe, ich nehme selbst Kontakt auf.",
      );
      await confirmSubstepIfAsked(page, caseId, "appointment.prepare");
      const prepared = z
        .object({ callSheet: z.string().min(1), emailDraft: z.string().min(1), ics: z.string() })
        .parse(await requireTool(page, caseId, "appointment.prepare"));
      expect(prepared.ics).toContain("STATUS:TENTATIVE");
      expect(prepared.callSheet).toContain(facility.title);
    });

    await test.step("Complete only the clarified responsibility step and show the durable journey", async () => {
      await say(
        page,
        `Die zuständige Anlaufstelle und die Kontaktentwürfe sind jetzt geklärt. Bitte schließen Sie mit process.completeStep nur den ersten Verwaltungsschritt ${responsibilityStepId} zur Zuständigkeitsklärung ab, mit meiner Aussage als Beleg (type user_statement). Bereiten Sie dann mit process.nextStep den nächsten offenen Schritt vor. Der medizinische Teil fehlt noch und der Antrag wurde nicht eingereicht.`,
      );
      await requireTool(page, caseId, "process.completeStep");
      const steps = await database.db.select().from(caseSteps).where(eq(caseSteps.caseId, caseId));
      expect(steps.find((step) => step.id === responsibilityStepId)?.status).toBe("completed");
      expect(steps.some((step) => step.status !== "completed")).toBe(true);
      await page.goto(`/journey?caseId=${caseId}`);
      await expect(page.getByText("Erledigt", { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("journey.png"), fullPage: true });
      await page.goto(`/documents?caseId=${caseId}`);
      await expect(page.getByRole("heading", { name: "Vorliegende Unterlagen" })).toBeVisible();
      await page.goto(`/offers?caseId=${caseId}`);
      await expect(page.getByRole("button", { name: "Karte laden", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Karte laden", exact: true }).click();
      await expect(page.getByRole("region", { name: "Karte der Einrichtungen" })).toBeVisible();
      await page.goto(
        `/appointments?caseId=${caseId}&facilityId=${encodeURIComponent(selectedFacilityId)}`,
      );
      await page.getByRole("button", { name: "Entwürfe vorbereiten", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Spickzettel für den Anruf", exact: true }),
      ).toHaveValue(/.+/u);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const date = tomorrow.toISOString().slice(0, 10);
      await page.getByLabel("Beginn (Ihre Ortszeit)").fill(`${date}T09:00`);
      await page.getByLabel("Ende (Ihre Ortszeit)").fill(`${date}T09:30`);
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("button", { name: ".ics herunterladen", exact: true }).click();
      const download = await downloadEvent;
      const calendar = testInfo.outputPath("appointment.ics");
      await download.saveAs(calendar);
      expect(await readFile(calendar, "utf8")).toContain("STATUS:TENTATIVE");
      expect(browserErrors).toEqual([]);
      expect((await outputs(page, caseId, "appointment.prepare")).length).toBeGreaterThan(0);
    });
  } catch (error) {
    await testInfo.attach("browser-state", {
      body: JSON.stringify({ path: new URL(page.url()).pathname, browserErrors }),
      contentType: "application/json",
    });
    await page
      .screenshot({ path: testInfo.outputPath("failure.png"), timeout: DEMO_E2E.uiTimeoutMs })
      .catch(() => undefined);
    await page
      .locator('[id^="message-"]')
      .last()
      .screenshot({
        path: testInfo.outputPath("last-assistant.png"),
        timeout: DEMO_E2E.uiTimeoutMs,
      })
      .catch(() => undefined);
    throw error;
  } finally {
    await page.close();
    if (subjectId) {
      const uploaded = await database.db
        .select()
        .from(documents)
        .where(eq(documents.subjectId, subjectId));
      for (const document of uploaded) await storage.delete(document.storageKey);
      await database.db.delete(subjects).where(eq(subjects.id, subjectId));
    }
    if (userId) await database.db.delete(users).where(eq(users.id, userId));
  }
});
