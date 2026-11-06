import { expect, test } from "./fixtures.ts";

test("case list opens the chosen journey and conversation and navigation keeps the case", async ({
  page,
  auditCase,
}) => {
  await page.goto("/cases");
  await page.getByRole("link", { name: "Weg ansehen", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`caseId=${auditCase.id}`));
  const navigation = page.getByRole("navigation", { name: "Arbeitsbereich", exact: true });
  for (const [label, route] of [
    ["Unterlagen", "documents"],
    ["Angebote & Einrichtungen", "offers"],
    ["Termine", "appointments"],
    ["Meine Fälle", "cases"],
    ["Mein Weg", "journey"],
  ] as const) {
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${route}\\?caseId=${auditCase.id}`));
  }
  await page.goto("/cases");
  await page.getByRole("link", { name: "Gespräch zu diesem Fall fortsetzen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gespräch fortsetzen" })).toBeVisible();
});
