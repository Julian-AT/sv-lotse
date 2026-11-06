import { expect, test } from "./fixtures.ts";

test("settings save, every preference, language and new session persist", async ({
  page,
  auditCase,
}) => {
  await page.goto(`/journey?caseId=${auditCase.id}`);
  const panel = page.locator("header details");
  await panel.locator("summary").click();
  await panel.getByLabel("Sprache", { exact: true }).selectOption("en");
  await panel.getByLabel("Simple language", { exact: true }).check();
  await panel.getByLabel("Form of address").selectOption("informal");
  await panel.getByLabel("Answer length").selectOption("brief");
  await panel.getByLabel("Speech speed").selectOption("0.5");
  await panel.getByLabel("Reduce motion", { exact: true }).check();
  await panel.getByLabel("High contrast", { exact: true }).check();
  await panel.getByLabel("Allow usage analytics (optional)").check();
  await panel.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Settings saved.");
  await expect(page.getByRole("heading", { name: "My journey", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await panel.getByLabel("Allow usage analytics (optional)").uncheck();
  await panel.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Settings saved.");
  const before = (await page.context().cookies()).find((cookie) => cookie.name === "lotse_session");
  await panel.getByRole("button", { name: "New session", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("New session started.");
  const after = (await page.context().cookies()).find((cookie) => cookie.name === "lotse_session");
  expect(after?.value).not.toBe(before?.value);
  expect(await (await page.request.get("/api/preferences")).json()).toMatchObject({
    language: "en",
    simpleLanguage: true,
    register: "informal",
    detailLevel: "brief",
    reducedMotion: true,
    highContrast: true,
    analyticsConsent: false,
    speechRate: 0.5,
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "My journey", exact: true })).toBeVisible();
  const autonomy = page.getByRole("group", { name: "Autonomy", exact: true });
  await autonomy.getByRole("button").first().click();
  await autonomy.locator("select").selectOption("L2");
  await autonomy.getByRole("button").last().click();
  await expect(autonomy.getByRole("button").first()).toContainText("L2");
  await page.reload();
  await expect(page.getByRole("banner")).toContainText("L2");
});

test("all screens follow the persisted profile even when the language cookie is stale", async ({
  page,
  auditCase,
}) => {
  expect((await page.request.patch("/api/profile", { data: { language: "en" } })).ok()).toBe(true);
  for (const [path, title] of [
    ["/journey", "My journey"],
    ["/cases", "My cases"],
    ["/documents", "Documents"],
    ["/offers", "Offers & facilities"],
    ["/appointments", "Appointments"],
    ["/guided", "Guided filling"],
    ["/helper", "Join as a helper"],
    [`/cases/${auditCase.id}`, "Continue conversation"],
  ] as const) {
    await page.goto(`${path}?caseId=${auditCase.id}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  }
  await page.goto("/workspace");
  await expect(page.getByRole("button", { name: "New case", exact: true })).toBeVisible();
});
