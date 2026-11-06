import { expect, test } from "./fixtures.ts";

test("home language links, voice toggles, onboarding forward/back and helper guide links work", async ({
  page,
  auditCase,
}) => {
  await page.goto("/");
  const setup = page.getByRole("region", {
    name: "Willkommen. Richten wir den Lotsen für Sie ein.",
    exact: true,
  });
  await setup.getByRole("button", { name: "Weiter", exact: true }).click();
  await setup.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(setup.getByLabel("Sprache", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Weiter", exact: true }).click();
  await setup.getByLabel("Weniger Bewegung", { exact: true }).check();
  await setup.getByLabel("Hoher Kontrast", { exact: true }).check();
  await setup.getByRole("button", { name: "Weiter", exact: true }).click();
  await setup
    .getByLabel("Wie viel darf der Lotse vorbereiten?", { exact: true })
    .selectOption("L2");
  await setup.getByRole("button", { name: "Einrichtung abschließen", exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Autonomie", exact: true }).getByRole("button").first(),
  ).toContainText("L2");
  await page.reload();
  await expect(setup).toHaveCount(0);
  const voice = page.getByRole("region", { name: "Mit dem Lotsen sprechen", exact: true });
  await voice.getByLabel("Antworten vorlesen", { exact: true }).uncheck();
  await expect(voice.getByLabel("Antworten vorlesen", { exact: true })).not.toBeChecked();
  await voice.getByLabel("Antworten vorlesen", { exact: true }).check();
  await voice.getByRole("slider").fill("1.5");
  await expect(voice.getByText("Sprechtempo (1.5×)", { exact: true })).toBeVisible();
  await voice.getByRole("button", { name: "Vorlesen stoppen", exact: true }).click();
  for (const [label, language] of [
    ["English", "en"],
    ["Einfache Sprache", "de"],
    ["Deutsch", "de"],
  ] as const) {
    await page.locator("header nav").getByRole("link", { name: label, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language === "de" ? "de-AT" : "en");
  }
  await page.getByRole("link", { name: "Zum Inhalt", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.getByRole("link", { name: "Ihr Gespräch", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator("#workspace-message")).toBeVisible();
  expect(auditCase.id).toBeTruthy();
});
