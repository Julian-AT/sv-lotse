import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./config.ts";

async function assertAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  const smallTargets = await page
    .locator("a, button, input, select, textarea, summary")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || element.closest("[hidden]")) return [];
        return rect.width < 44 || rect.height < 44
          ? [{ tag: element.tagName, width: rect.width, height: rect.height }]
          : [];
      }),
    );
  expect(smallTargets).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

for (const language of ["de", "en"] as const) {
  test(`@smoke NFR-6 all onboarding steps, settings and setup guide pass axe and 44px targets in ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/?lang=${language}`);
    const setup = page.getByRole("region", {
      name:
        language === "de"
          ? "Willkommen. Richten wir den Lotsen für Sie ein."
          : "Welcome. Let’s set up your guide.",
    });
    await expect(setup).toBeVisible();
    await assertAccessible(page);
    for (let step = 0; step < 2; step++) {
      await setup
        .getByRole("button", { name: language === "de" ? "Weiter" : "Next", exact: true })
        .click();
      await expect(setup.getByRole("heading", { level: 3 })).toBeFocused();
      await assertAccessible(page);
    }
    await setup
      .getByRole("button", { name: language === "de" ? "Einrichtung abschließen" : "Finish setup" })
      .click();
    await expect(setup).toBeHidden();
    const settings = page.locator("header details");
    await settings.locator("summary").click();
    await assertAccessible(page);
    await page.goto("/setup-guide");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await assertAccessible(page);
  });
}

test("@smoke FR-L4 settings survive reload and session reset; analytics consent can be withdrawn", async ({
  page,
}) => {
  await page.goto("/");
  const setup = page.locator('section[aria-labelledby="setup-title"]');
  await expect(setup.getByRole("checkbox", { name: "Einfache Sprache" })).not.toBeChecked();
  await setup.getByLabel("Sprache", { exact: true }).selectOption("en");
  await setup.getByRole("checkbox", { name: "Simple language", exact: true }).check();
  await setup.getByLabel("Form of address").selectOption("informal");
  await setup.getByLabel("Answer length").selectOption("brief");
  await setup.getByRole("button", { name: "Next", exact: true }).click();
  await setup.getByLabel("Reduce motion", { exact: true }).check();
  await setup.getByLabel("High contrast", { exact: true }).check();
  await setup.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    setup.getByRole("checkbox", { name: "Allow usage analytics (optional)" }),
  ).not.toBeChecked();
  await setup.getByLabel("How much may the guide prepare?", { exact: true }).selectOption("L2");
  await setup.getByRole("checkbox", { name: "Allow usage analytics (optional)" }).check();
  await setup.getByRole("button", { name: "Finish setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome. Let’s set up your guide." }),
  ).toBeHidden();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator("header")).toContainText("Current level: L2");
  const settings = page.locator("header details");
  await settings.locator("summary").click();
  await expect(settings.getByLabel("Form of address")).toHaveValue("informal");
  await expect(settings.getByLabel("Answer length")).toHaveValue("brief");
  await expect(settings.getByLabel("Simple language", { exact: true })).toBeChecked();
  await settings.getByLabel("Allow usage analytics (optional)").uncheck();
  await settings.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("Settings saved.");
  await assertAccessible(page);
  await settings.getByRole("button", { name: "New session", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveText("New session started.");
  const preferences = await (await page.request.get("/api/preferences")).json();
  expect(preferences).toMatchObject({
    language: "en",
    simpleLanguage: true,
    register: "informal",
    detailLevel: "brief",
    autonomyLevel: "L2",
    analyticsConsent: false,
    onboardingCompleted: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome. Let’s set up your guide." }),
  ).toBeHidden();
});

test("@smoke NFR-6 settings follow native keyboard order and Escape restores focus", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.locator("header details");
  const summary = settings.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(settings.getByLabel("Sprache", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
  await expect(settings).not.toHaveAttribute("open");
});

test("@smoke FR-A1 preference writes require a session, reject identity injection and reject cross-origin writes", async ({
  page,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext();
  try {
    expect((await anonymous.get(`${E2E_BASE_URL}/api/preferences`)).status()).toBe(401);
    expect(
      (
        await anonymous.patch(`${E2E_BASE_URL}/api/preferences`, {
          data: { autonomyLevel: "L3" },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  await page.goto("/");
  expect(
    (
      await page.request.patch("/api/preferences", {
        data: { userId: "foreign", autonomyLevel: "L3" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.patch("/api/preferences", {
        headers: { origin: "https://foreign.example" },
        data: { autonomyLevel: "L3" },
      })
    ).status(),
  ).toBe(403);
  expect(await (await page.request.get("/api/preferences")).json()).toMatchObject({
    autonomyLevel: "L1",
    analyticsConsent: false,
  });
});
