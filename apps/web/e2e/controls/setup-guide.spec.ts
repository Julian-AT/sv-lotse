import { expect, test } from "./fixtures.ts";

test("setup guide print button invokes the actual browser print lifecycle", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("beforeprint", () =>
      document.documentElement.setAttribute("data-print-requested", "true"),
    );
  });
  await page.goto("/setup-guide");
  await page.getByRole("button", { name: "Anleitung für Angehörige drucken", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");
});
