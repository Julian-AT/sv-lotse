import { expect, test } from "./fixtures.ts";

for (const decision of ["Beitritt erlauben", "Ablehnen und beenden"] as const) {
  test(`helper invitation copies the link, requests admission and ${decision}`, async ({
    page,
    browser,
    baseURL,
    context,
    auditCase,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    if (!baseURL) throw new Error("AUDIT_BASE_URL_REQUIRED");
    const helperContext = await browser.newContext({ baseURL });
    try {
      const helper = await helperContext.newPage();
      await helper.goto("/helper");
      // Compile the real dev routes before creating transient invite UI; cold-route HMR reloads it.
      await helper.request.get("/api/relatives/join");
      await helper.request.get("/api/relatives/session");
      await helper.request.get("/api/relatives/token");
      await page.goto("/");
      await page.getByRole("button", { name: "Hilfsperson einladen", exact: true }).click();
      const link = await page
        .getByLabel("Einladungslink (15 Minuten gültig)", { exact: true })
        .inputValue();
      expect(new URL(link).hash).toMatch(/^#[a-f0-9]{64}$/);
      await page.getByRole("button", { name: "Link kopieren", exact: true }).click();
      await expect(page.getByRole("button", { name: "Link kopiert", exact: true })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
      await helper.goto(link);
      await helper.getByRole("button", { name: "Beitritt anfragen", exact: true }).click();
      await expect(
        helper.getByText("Warten auf die Freigabe durch die einladende Person …", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: decision, exact: true }).click();
      if (decision === "Beitritt erlauben") {
        await expect(
          page.getByRole("button", { name: "Bildschirm und Stimme verbinden", exact: true }),
        ).toBeVisible();
        await expect(
          helper.getByRole("button", {
            name: "Stimme verbinden und Bildschirm ansehen",
            exact: true,
          }),
        ).toBeVisible();
        await helper.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
      }
      await expect(
        page.getByText("Die Hilfesitzung ist beendet oder abgelaufen.", { exact: true }),
      ).toBeVisible();
      await expect(
        helper.getByText("Die Hilfesitzung ist beendet oder abgelaufen.", { exact: true }),
      ).toBeVisible();
      expect(auditCase.id).toBeTruthy();
    } finally {
      await helperContext.close();
    }
  });
}

test("invalid helper link has a visible explanation and no enabled join action", async ({
  page,
}) => {
  await page.goto("/helper");
  await expect(page.getByRole("button", { name: "Beitritt anfragen", exact: true })).toBeDisabled();
  await expect(
    page.getByText("Öffnen Sie einen gültigen Einladungslink.", { exact: true }),
  ).toBeVisible();
});
