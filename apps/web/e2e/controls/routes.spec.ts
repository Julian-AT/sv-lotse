import { expect, test } from "./fixtures.ts";

test("every static screen renders its controls without browser errors", async ({
  page,
  auditCase,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["/workspace", "/helper"]) {
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

test("browsers get the service notice and the mac app hint instead of the chat", async ({
  playwright,
  baseURL,
}) => {
  const browser = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    userAgent: "Mozilla/5.0",
  });
  try {
    expect(await (await browser.get("/")).text()).toContain("Mac-App");
    const chat = await browser.get("/workspace");
    expect(chat.status()).toBe(403);
    expect(await chat.text()).toContain("Bitte öffnen Sie SV KI-Lotse in der Mac-App.");
    expect((await browser.get("/helper")).status()).toBe(200);
  } finally {
    await browser.dispose();
  }
});
