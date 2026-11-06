import { createSubjectService } from "@lotse/brain/subjects";
import { database, expect, test } from "./fixtures.ts";

test("scoped invite page requests, refreshes and ends a real pending helper session", async ({
  browser,
  baseURL,
  auditCase,
}) => {
  const subjectService = createSubjectService(database, auditCase.userId);
  const invitation = await subjectService.inviteHelper({
    caseId: auditCase.id,
    shareScope: { mode: "full" },
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  if (!baseURL) throw new Error("AUDIT_BASE_URL_REQUIRED");
  const helperContext = await browser.newContext({ baseURL });
  try {
    await helperContext.request.get("/");
    await helperContext.request.get("/api/invites/accept");
    await helperContext.request.get("/api/invites/sessions");
    const helper = await helperContext.newPage();
    await helper.goto(`/invite/${invitation.token}`);
    await helper.getByRole("button", { name: "Beitritt anfragen", exact: true }).click();
    await expect(helper.getByRole("status")).toContainText("Ihre Anfrage wartet auf Bestätigung.");
    await helper.getByRole("button", { name: "Status aktualisieren", exact: true }).click();
    await expect(helper.getByRole("status")).toContainText("Es werden noch keine Daten geteilt.");
    await helper.getByRole("button", { name: "Sitzung beenden", exact: true }).click();
    await expect(helper.getByRole("status")).toHaveText("Die Helfer-Sitzung ist beendet.");
    await expect(
      helper.getByRole("button", { name: "Status aktualisieren", exact: true }),
    ).toHaveCount(0);
  } finally {
    await helperContext.close();
  }
});
