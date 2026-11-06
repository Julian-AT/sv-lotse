import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.ts";

test("appointments prepare editable drafts, copy both texts and download a real calendar hold", async ({
  page,
  context,
  auditCase,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/appointments?caseId=${auditCase.id}`);
  const selector = page.getByLabel("Einrichtung auswählen");
  await expect(selector.locator("option").nth(1)).toBeAttached();
  await selector.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Entwürfe vorbereiten", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Spickzettel für den Anruf", exact: true }),
  ).not.toHaveValue("");
  for (const [label, value] of [
    ["Spickzettel für den Anruf", "Meine Fragen zum Antrag"],
    ["E-Mail-Entwurf", "Bitte um einen Beratungstermin"],
  ] as const) {
    const input = page.getByRole("textbox", { name: label, exact: true });
    await input.fill(value);
    const section = page.getByRole("region", { name: label, exact: true });
    await section.getByRole("button", { name: "Text kopieren", exact: true }).click();
    await expect(section.getByRole("status")).toHaveText("Kopiert");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  }
  await page.getByLabel("Betreff", { exact: true }).fill("Beratung");
  await page.getByRole("button", { name: ".ics herunterladen", exact: true }).click();
  await expect(
    page.getByText("Bitte wählen Sie einen Beginn und ein späteres Ende."),
  ).toBeVisible();
  await page.getByLabel("Beginn (Ihre Ortszeit)").fill("2026-11-09T09:00");
  await page.getByLabel("Ende (Ihre Ortszeit)").fill("2026-11-09T09:30");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: ".ics herunterladen", exact: true }).click();
  const download = await event;
  const path = info.outputPath("appointment.ics");
  await download.saveAs(path);
  expect(await readFile(path, "utf8")).toContain("STATUS:TENTATIVE");
  await expect(page.getByText("Kalendervormerkung heruntergeladen.")).toBeVisible();
});
