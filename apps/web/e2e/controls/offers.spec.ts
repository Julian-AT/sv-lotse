import { expect, test } from "./fixtures.ts";

test("map search, type, location, radius, markers and appointment links change the visible result", async ({
  page,
  context,
  auditCase,
}) => {
  await context.grantPermissions(["geolocation"], { origin: new URL(page.url()).origin });
  await context.setGeolocation({ latitude: 48.2, longitude: 16.37 });
  await page.goto(`/offers?caseId=${auditCase.id}`);
  const cards = page.locator("main li").filter({ has: page.getByRole("heading", { level: 2 }) });
  await expect(cards.first()).toBeVisible();
  const total = await cards.count();
  const search = page.getByLabel("Ort, Einrichtung oder Angebot suchen");
  await search.fill("definitely-no-matching-facility");
  await expect(cards).toHaveCount(0);
  await expect(
    page.getByText("Im Verzeichnis sind noch keine passenden Einrichtungen hinterlegt."),
  ).toBeVisible();
  await search.fill("");
  await expect(cards).toHaveCount(total);
  const types = page.getByLabel("Art des Angebots");
  await types.selectOption({ index: 1 });
  expect(await cards.count()).toBeGreaterThan(0);
  await types.selectOption("");
  await page.getByRole("button", { name: "Meinen Standort verwenden" }).click();
  await expect(page.getByLabel("Umkreis in km")).toBeVisible();
  await page.getByLabel("Umkreis in km").fill("1");
  await page.getByLabel("Umkreis in km").fill("1000");
  await page.getByRole("button", { name: "Karte laden", exact: true }).click();
  const map = page.getByRole("region", { name: "Karte der Einrichtungen" });
  await expect(map).toBeVisible();
  const show = page.getByRole("button", { name: "Auf der Karte zeigen", exact: true }).first();
  await show.click();
  const selected = page.locator('li[aria-current="true"]');
  await expect(selected).toBeVisible();
  const title = await selected.getByRole("heading").textContent();
  if (!title) throw new Error("FACILITY_TITLE_REQUIRED");
  await map.getByRole("button", { name: title, exact: true }).click();
  await expect(selected).toHaveAttribute("aria-current", "true");
  await selected.locator("summary").first().click();
  await expect(selected.locator("blockquote").first()).toBeVisible();
  await selected.getByRole("link", { name: "Termin vorbereiten", exact: true }).click();
  await expect(page).toHaveURL(/\/appointments\?/);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});
