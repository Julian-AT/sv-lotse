import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@smoke FR-L3 profile settings persist and switch the real workspace to English and simple German", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const settings = {
    language: "en",
    simpleLanguage: true,
    register: "informal",
    detailLevel: "brief",
  };
  const saved = await context.request.patch("/api/profile", { data: settings });
  expect(saved.status()).toBe(200);
  expect(saved.headers()["cache-control"]).toBe("private, no-store");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your next step. At your pace.");
  const panel = page.locator("header details");
  await panel.locator("summary").click();
  await expect(panel.getByLabel("Language", { exact: true })).toHaveValue("en");
  await expect(panel.getByLabel("Simple language", { exact: true })).toBeChecked();
  await expect(panel.getByLabel("Form of address")).toHaveValue("informal");
  await expect(panel.getByLabel("Answer length")).toHaveValue("brief");
  await panel.getByLabel("Language", { exact: true }).selectOption("de");
  await panel.getByRole("button", { name: "Einstellungen speichern", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ihr nächster Schritt. Sie bestimmen das Tempo.",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "de-AT");
  await expect(panel.getByLabel("Sprache", { exact: true })).toHaveValue("de");
  expect(await (await context.request.get("/api/profile")).json()).toEqual({
    ...settings,
    language: "de",
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ihr nächster Schritt. Sie bestimmen das Tempo.",
  );
  await page.goto("/?lang=de-simple");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ihr nächster Schritt. Sie bestimmen das Tempo.",
  );
  expect(await (await context.request.get("/api/preferences")).json()).toMatchObject({
    language: "de",
    simpleLanguage: true,
  });
});

test("@smoke NFR-7 profile API rejects unsupported languages and permission changes", async ({
  page,
  context,
}) => {
  await page.goto("/");
  for (const data of [
    { language: "fr" },
    { autonomyLevel: "L3" },
    { userId: "another-user", register: "informal" },
  ]) {
    const response = await context.request.patch("/api/profile", { data });
    expect(response.status()).toBe(400);
  }
  expect(
    (
      await context.request.patch("/api/profile", {
        data: { language: "en" },
        headers: { origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
});
