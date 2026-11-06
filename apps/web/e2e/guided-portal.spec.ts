import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("FR-D7 workspace exposes guided portals and rejects a non-allowlisted address before opening", async ({
  page,
  context,
}) => {
  await page.goto("/?lang=en");
  await page.getByRole("link", { name: "Fill a portal together" }).click();
  await expect(page.getByRole("heading", { name: "Guided filling" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture visible fields" })).toBeDisabled();
  expect(await page.locator("#portal-origins option").count()).toBeGreaterThan(0);
  await page.getByLabel("Portal address").fill("https://not-allowlisted.example/form");
  await page.getByRole("button", { name: "Open portal in a new window" }).click();
  await expect(page.getByRole("status")).toContainText("Connection unavailable");
  expect(context.pages()).toHaveLength(1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("FR-D7 injectable runtime is public code with a JavaScript content type and no session response", async ({
  request,
}) => {
  const response = await request.get("/api/guide/runtime");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/javascript");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  const script = await response.text();
  expect(script).toContain("__lotseGuide");
  expect(Buffer.byteLength(script)).toBeLessThan(512 * 1024);
});
