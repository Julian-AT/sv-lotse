import type { DatabaseClient } from "@lotse/db";
import { auditEvents, cases, documents, formInstances, messages } from "@lotse/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { CASE_FILE_CONFIG } from "../config/index.ts";
import { authorizeCase, requireIdleCase } from "./access.ts";
import { caseOperation, type ObjectStorage } from "./schema.ts";
import { createCaseFileService } from "./service.ts";

const titleSchema = z.strictObject({
  title: z.string().trim().min(1).max(CASE_FILE_CONFIG.maxTitleLength),
});

/** Presentation metadata never changes the confirmed administrative goal. */
export function dashboardTitle(journeyMap: unknown, confirmedGoal: string): string {
  const parsed = z.object({ dashboardTitle: z.string() }).safeParse(journeyMap);
  return parsed.success ? parsed.data.dashboardTitle : confirmedGoal;
}

export interface CaseDashboardService {
  list(): Promise<{ id: string; title: string; lastActivity: string }[]>;
  rename(caseId: string, input: unknown): Promise<void>;
  delete(caseId: string, storage: Pick<ObjectStorage, "delete">): Promise<void>;
}

export function createCaseDashboardService(
  db: DatabaseClient,
  authenticatedUserId: string,
): CaseDashboardService {
  const userId = z.uuid().parse(authenticatedUserId);
  return {
    async list(): Promise<{ id: string; title: string; lastActivity: string }[]> {
      const records = await createCaseFileService(db, userId).list();
      if (!records.length) return [];
      const activity = await db
        .select({
          caseId: messages.caseId,
          at: sql<string>`max(${messages.createdAt})`,
        })
        .from(messages)
        .where(
          inArray(
            messages.caseId,
            records.map((row) => row.id),
          ),
        )
        .groupBy(messages.caseId);
      const latest = new Map(activity.map((row) => [row.caseId, row.at]));
      return records
        .map((row) => ({
          id: row.id,
          title: dashboardTitle(row.journeyMap, row.confirmedGoal),
          lastActivity: new Date(latest.get(row.id) ?? row.createdAt).toISOString(),
        }))
        .sort(
          (left, right) =>
            right.lastActivity.localeCompare(left.lastActivity) || left.id.localeCompare(right.id),
        );
    },
    rename(caseId: string, input: unknown): Promise<void> {
      return caseOperation(() =>
        db.transaction(async (tx) => {
          z.uuid().parse(caseId);
          const { title } = titleSchema.parse(input);
          const row = await authorizeCase(tx, caseId, userId, true);
          const prior = row.case.journeyMap;
          const envelope =
            prior !== null && typeof prior === "object" && !Array.isArray(prior)
              ? prior
              : { previousJourneyMap: prior };
          await tx
            .update(cases)
            .set({ journeyMap: { ...envelope, dashboardTitle: title } })
            .where(eq(cases.id, caseId));
          await tx
            .insert(auditEvents)
            .values({ actorId: userId, action: "case.renamed", target: { caseId } });
        }),
      );
    },
    delete(caseId: string, storage: Pick<ObjectStorage, "delete">): Promise<void> {
      return caseOperation(() =>
        db.transaction(async (tx) => {
          z.uuid().parse(caseId);
          await authorizeCase(tx, caseId, userId, true);
          await requireIdleCase(tx, caseId);
          const outputs = await tx
            .select({ key: formInstances.outputKey })
            .from(formInstances)
            .where(eq(formInstances.caseId, caseId));
          for (const key of new Set(outputs.flatMap((row) => (row.key ? [row.key] : [])))) {
            const [otherForm] = await tx
              .select({ id: formInstances.id })
              .from(formInstances)
              .where(and(ne(formInstances.caseId, caseId), eq(formInstances.outputKey, key)))
              .limit(1);
            const [document] = await tx
              .select({ id: documents.id })
              .from(documents)
              .where(eq(documents.storageKey, key))
              .limit(1);
            if (!otherForm && !document) await storage.delete(key);
          }
          // Case-owned messages, turns, approvals, jobs and form instances cascade. Subject documents remain shared.
          await tx.delete(cases).where(eq(cases.id, caseId));
          await tx
            .insert(auditEvents)
            .values({ actorId: userId, action: "case.deleted", target: { caseId } });
        }),
      );
    },
  };
}
