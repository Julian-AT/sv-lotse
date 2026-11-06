import { caseSteps } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { database, expect, test } from "./fixtures.ts";

test("journey starts and completes a persisted user step and opens its conversation", async ({
  page,
  auditCase,
}) => {
  await page.goto(`/journey?caseId=${auditCase.id}`);
  await page.getByRole("button", { name: "Schritt beginnen", exact: true }).click();
  await expect(page.getByText("In Arbeit", { exact: true })).toBeVisible();
  const [started] = await database.db
    .select()
    .from(caseSteps)
    .where(eq(caseSteps.id, auditCase.stepId));
  expect(started?.status).toBe("in_progress");
  await page.getByRole("button", { name: "Als erledigt markieren", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Als erledigt markieren", exact: true }),
  ).toHaveCount(0);
  const [completed] = await database.db
    .select()
    .from(caseSteps)
    .where(eq(caseSteps.id, auditCase.stepId));
  expect(completed?.status).toBe("completed");
  await page.reload();
  await expect(page.getByRole("button", { name: "Schritt beginnen", exact: true })).toHaveCount(0);
  await page.getByText("Verlauf", { exact: true }).click();
  await expect(page.getByText("Schritt abgeschlossen", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Gespräch zu diesem Fall fortsetzen", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${auditCase.id}$`));
  await expect(page.locator("#case-message")).toBeEnabled();
});
