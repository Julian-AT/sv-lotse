import AxeBuilder from "@axe-core/playwright";
import { createDatabase } from "@lotse/brain/db";
import { createRelativeService } from "@lotse/brain/relatives";
import { createSubjectService } from "@lotse/brain/subjects";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { relativesCopy } from "../src/features/relatives/copy.ts";

// Acceptance fixtures are constructed through the real brain and persisted in Postgres.
test("settings groups save and reload and stay accessible on a narrow screen", async ({ page }) => {
  await page.goto("/");
  const settings = page.locator("header details");
  await settings.locator("summary").click();
  for (const name of [
    "Profil & Sprache",
    "Assistent",
    "Stimme",
    "Datenschutz",
    "Hilfspersonen",
    "Verbindungen",
  ])
    await expect(settings.getByRole("heading", { name, exact: true })).toBeVisible();
  await settings.getByLabel("Anrede").selectOption("informal");
  await settings.getByLabel("Länge der Antworten").selectOption("brief");
  await settings.getByLabel("Sprechgeschwindigkeit").selectOption("0.5");
  await settings.getByRole("button", { name: "Einstellungen speichern", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("Einstellungen gespeichert.");
  await page.reload();
  await settings.locator("summary").click();
  await expect(settings.getByLabel("Anrede")).toHaveValue("informal");
  await expect(settings.getByLabel("Länge der Antworten")).toHaveValue("brief");
  await expect(settings.getByLabel("Sprechgeschwindigkeit")).toHaveValue("0.5");
  await page.setViewportSize({ width: 320, height: 800 });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(settings.locator("summary")).toBeFocused();
  await expect(settings).not.toHaveAttribute("open");
});

test("helper invites preserve the chosen scope and require approval before persisted access", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const identity = z
    .object({ userId: z.uuid(), sessionId: z.uuid() })
    .parse(await (await page.request.post("/api/session")).json());
  const database = createDatabase();
  const service = createSubjectService(database, identity.userId, identity.sessionId);
  const helper = await browser.newContext();
  let subjectId: string | undefined;
  try {
    const subject = await service.createSubject({
      displayName: "Settings acceptance",
      relationToUser: "self",
    });
    subjectId = subject.id;
    const { case: record } = await service.createCase({
      subjectId: subject.id,
      confirmedGoal: "Unterlagen gemeinsam ordnen",
    });
    await page.reload();
    const relatives = createRelativeService(database, identity);
    const copy = relativesCopy.de;
    const settings = page.locator("header details");
    await settings.locator("summary").click();
    const panel = settings.getByRole("region", { name: "Hilfspersonen", exact: true });
    await panel.getByLabel(copy.caseLabel).selectOption(record.id);
    await panel.getByRole("combobox", { name: copy.scopeLabel }).selectOption("case");
    await panel.getByRole("button", { name: copy.invite, exact: true }).click();
    const link = await panel.getByLabel(copy.link).inputValue();
    const helperPage = await helper.newPage();
    await helperPage.goto(link);
    await helperPage.getByRole("button", { name: "Beitritt anfragen" }).click();
    await expect(helperPage.getByText(copy.approval, { exact: true })).toBeVisible();
    await expect(panel.getByText(copy.pending, { exact: true })).toBeVisible();
    const [pending] = await relatives.listSessions(record.id);
    expect(pending?.state).toBe("pending");
    if (!pending) throw new Error("PENDING_JOIN_MISSING");
    const [stored] = await database.sql`SELECT i.share_scope FROM helper_invite i
      JOIN relative_session r ON r.invite_id = i.id WHERE r.id = ${pending.id}`;
    expect(stored?.share_scope).toEqual({ mode: "restricted", case: true, factTypes: [] });
    expect(await service.listHelperSessions(record.id)).toEqual([]);
    await panel.getByRole("button", { name: copy.approve, exact: true }).click();
    await expect(panel.getByRole("button", { name: copy.connect, exact: true })).toBeVisible();
    expect((await service.listHelperSessions(record.id))[0]?.shareScope).toEqual(
      stored?.share_scope,
    );
    await page.reload();
    await settings.locator("summary").click();
    await expect(panel.getByRole("button", { name: copy.connect, exact: true })).toBeVisible();
    await panel.getByRole("button", { name: copy.pauseSharing, exact: true }).click();
    await expect(panel.getByText(copy.paused, { exact: true })).toBeVisible();
    expect((await relatives.getSession(pending.id)).paused).toBe(true);
    await panel.getByRole("button", { name: copy.resumeSharing, exact: true }).click();
    await expect(panel.getByRole("button", { name: copy.connect, exact: true })).toBeVisible();
    expect((await relatives.getSession(pending.id)).paused).toBe(false);
    await panel.getByRole("button", { name: copy.end, exact: true }).click();
    await expect(panel.getByRole("button", { name: copy.connect, exact: true })).toHaveCount(0);
    expect((await relatives.getSession(pending.id)).state).toBe("ended");
    expect(await service.listHelperSessions(record.id)).toEqual([]);
  } finally {
    await helper.close();
    if (subjectId) await service.deleteSubject(subjectId);
    await database.close();
  }
});

test("connection details are session protected and report all six real checks without credentials", async ({
  page,
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext();
  try {
    expect((await anonymous.get(`${baseURL}/api/health/details`)).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  await page.goto("/");
  const response = await page.request.get("/api/health/details");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const result = z
    .object({
      checkedAt: z.iso.datetime(),
      connections: z.array(
        z.object({ id: z.string(), status: z.enum(["verified", "missing"]), reason: z.string() }),
      ),
    })
    .parse(await response.json());
  expect(result.connections.map((row) => row.id)).toEqual([
    "brain",
    "database",
    "storage",
    "openai",
    "elevenlabs",
    "livekit",
  ]);
  expect(result.connections.find((row) => row.id === "database")?.status).toBe("verified");
  expect(result.connections.find((row) => row.id === "storage")?.status).toBe("verified");
  for (const row of result.connections)
    expect(Object.keys(row).sort()).toEqual(["id", "reason", "status"]);
});

test("privacy exports a real archive, resets the session and deletes the test user's data", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.locator("header details");
  await settings.locator("summary").click();
  const identitySchema = z.object({ userId: z.uuid(), sessionId: z.uuid() });
  const before = identitySchema.parse(await (await page.request.post("/api/session")).json());
  const archive = await page.request.post("/api/export");
  expect(archive.status()).toBe(200);
  expect((await archive.body()).subarray(0, 2).toString()).toBe("PK");
  const downloadEvent = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Daten exportieren", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("lotse-data.zip");
  await expect(settings.getByRole("status")).toHaveText("Datenexport heruntergeladen.");
  await settings.getByRole("button", { name: "Neue Sitzung", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("Neue Sitzung gestartet.");
  const after = identitySchema.parse(await (await page.request.post("/api/session")).json());
  expect(after.userId).toBe(before.userId);
  expect(after.sessionId).not.toBe(before.sessionId);
  await settings.getByRole("button", { name: "Daten löschen", exact: true }).click();
  await settings.getByRole("button", { name: "Alle Daten endgültig löschen" }).click();
  await expect(settings.getByRole("status")).toHaveText(
    "Ihre gespeicherten Daten wurden gelöscht.",
  );
  // The deleted identity cannot be reused. The next page request establishes a fresh anonymous one.
  await page.reload();
  const fresh = identitySchema.parse(await (await page.request.post("/api/session")).json());
  expect(fresh.userId).not.toBe(before.userId);
});
