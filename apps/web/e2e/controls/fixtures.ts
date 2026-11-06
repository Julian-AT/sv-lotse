import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { caseSteps, users } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { test as base, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const database = createDatabase();
export const storage = createObjectStorage();
export const test = base.extend<
  {
    auditCase: { id: string; subjectId: string; stepId: string; userId: string };
  },
  { auditServices: undefined }
>({
  auditServices: [
    async ({ browserName }, use) => {
      expect(browserName).toBe("chromium");
      await use(undefined);
      await database.close();
      storage.close();
    },
    { scope: "worker", auto: true },
  ],
  auditCase: async ({ page }, use) => {
    await page.goto("/workspace");
    const identity = z
      .object({ userId: z.uuid() })
      .parse(await (await page.request.post("/api/session")).json());
    const response = await page.request.post("/api/cases");
    expect(response.ok()).toBe(true);
    const { case: record } = z
      .object({
        case: z.object({ id: z.uuid(), subjectId: z.uuid() }),
      })
      .parse(await response.json());
    // Administrative state that a new case cannot provide on its own; real database, no mocks.
    const stepId = randomUUID();
    await database.db.insert(caseSteps).values({
      id: stepId,
      caseId: record.id,
      processStep: "Unterlagen prüfen",
      status: "pending",
      owner: "user",
      initiatedBy: "user",
    });
    await use({ ...record, stepId, userId: identity.userId });
    await database.db.delete(users).where(eq(users.id, identity.userId));
  },
});
export { expect };
