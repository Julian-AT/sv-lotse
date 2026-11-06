import { createDatabase } from "@lotse/db";
import { caseActors, cases, subjects } from "@lotse/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

test("FR-A1 changes autonomy only on explicit confirmation and persists across reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const panel = page.getByRole("group", { name: "Autonomie" });
  const toggle = panel.getByRole("button", { name: /^Autonomie:/ });
  await expect(toggle).toContainText("L1");
  await toggle.click();
  await panel.getByLabel("Gewünschte Stufe").selectOption("L3");
  expect(await (await context.request.get("/api/settings/autonomy")).json()).toEqual({
    autonomyLevel: "L1",
  });
  await panel.getByRole("button", { name: "Stufenwechsel bestätigen" }).click();
  await expect(toggle).toContainText("L3");
  await page.reload();
  await expect(toggle).toContainText("L3");
  const unconfirmed = await context.request.patch("/api/settings/autonomy", {
    data: { autonomyLevel: "L2" },
  });
  expect(unconfirmed.status()).toBe(400);
  expect(await (await context.request.get("/api/settings/autonomy")).json()).toEqual({
    autonomyLevel: "L3",
  });
});

test("FR-O6 serves guide policy only for the authenticated case and reads packaged allowlist data", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const identity = (await (await context.request.post("/api/session")).json()) as {
    userId: string;
  };
  const database = createDatabase();
  let subjectId: string | undefined;
  try {
    const [subject] = await database.db
      .insert(subjects)
      .values({ displayName: "Policy test", relationToUser: "self", createdBy: identity.userId })
      .returning();
    if (!subject) throw new Error("Subject insert failed");
    subjectId = subject.id;
    const [record] = await database.db
      .insert(cases)
      .values({ subjectId, confirmedGoal: "Verwaltungsunterlagen" })
      .returning();
    if (!record) throw new Error("Case insert failed");
    const endpoint = `/api/guide/booking?caseId=${record.id}`;
    expect((await context.request.get(endpoint)).status()).toBe(403);
    await database.db
      .insert(caseActors)
      .values({ caseId: record.id, userId: identity.userId, role: "subject", shareScope: {} });
    const response = await context.request.get(endpoint);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      autonomyLevel: "L1",
      ghostPreview: true,
      bookingPages: [],
      allowlist: expect.arrayContaining(["https://www.oegk.at"]),
    });
  } finally {
    if (subjectId) await database.db.delete(subjects).where(eq(subjects.id, subjectId));
    await database.close();
  }
});
