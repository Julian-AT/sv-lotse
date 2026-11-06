import { expect, test } from "./fixtures.ts";

test("every static screen renders its controls without browser errors", async ({
  page,
  auditCase,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of [
    "/",
    "/workspace",
    "/cases",
    "/journey",
    "/documents",
    "/offers",
    "/appointments",
    "/guided",
    "/helper",
    "/setup-guide",
    `/cases/${auditCase.id}`,
  ]) {
    const response = await page.goto(
      `${route}${route.includes("?") ? "&" : "?"}caseId=${auditCase.id}`,
    );
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await info.attach(route.replaceAll("/", "_") || "home", {
      body: JSON.stringify(
        await page.locator("button, a, select, summary, input").evaluateAll((elements) =>
          elements.map((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim(),
            label: element.getAttribute("aria-label"),
            href: element.getAttribute("href"),
          })),
        ),
        null,
        2,
      ),
      contentType: "application/json",
    });
  }
  expect(errors).toEqual([]);
});
