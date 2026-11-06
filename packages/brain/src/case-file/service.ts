import type { DatabaseClient } from "@lotse/db";
import { auditEvents, caseActors, caseSteps, cases, reminders, subjects } from "@lotse/db/schema";
import type { CaseEvent } from "@lotse/protocol";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { JsonValue } from "../engine/schema.ts";
import { helperSessionAccess } from "../subjects/session-access.ts";
import { authorizeCase, hasFullCaseScope, requireIdleCase } from "./access.ts";
import { appendCaseEvent } from "./events.ts";
import { readCaseHistory } from "./history.ts";
import { caseOperation, casePatchSchema } from "./schema.ts";
import { saveCaseStep } from "./steps.ts";

type CaseRow = typeof cases.$inferSelect;
type SubjectRow = typeof subjects.$inferSelect;
type StepRow = typeof caseSteps.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;

export interface CaseFileService {
  list(): Promise<
    (CaseRow & { subject: Pick<SubjectRow, "id" | "displayName" | "relationToUser"> })[]
  >;
  get(
    caseId: string,
  ): Promise<CaseRow & { subject: SubjectRow; steps: StepRow[]; reminders: ReminderRow[] }>;
  history(caseId: string): ReturnType<typeof readCaseHistory>;
  update(caseId: string, raw: unknown, recordEvent?: boolean): Promise<CaseEvent[]>;
  saveStep(
    caseId: string,
    raw: unknown,
    stepId?: string,
    evidence?: Record<string, JsonValue>,
  ): Promise<{ step: StepRow; event: CaseEvent }>;
}

/** Identity is bound by the authenticated server adapter, never accepted from request JSON. */
export function createCaseFileService(
  db: DatabaseClient,
  authenticatedUserId: string,
  sessionId?: string,
): CaseFileService {
  const userId = z.uuid().parse(authenticatedUserId);
  return {
    list: () =>
      caseOperation(async () => {
        const rows = await db
          .select({ case: cases, subject: subjects, actor: caseActors })
          .from(cases)
          .innerJoin(subjects, eq(subjects.id, cases.subjectId))
          .leftJoin(caseActors, and(eq(caseActors.caseId, cases.id), eq(caseActors.userId, userId)))
          .where(
            or(
              eq(subjects.createdBy, userId),
              eq(caseActors.role, "subject"),
              and(
                eq(caseActors.userId, userId),
                helperSessionAccess(sql`${cases.id}`, userId, sessionId),
              ),
            ),
          )
          .orderBy(asc(cases.createdAt), asc(cases.id));
        return rows
          .filter(
            (row) =>
              row.subject.createdBy === userId ||
              row.actor?.role === "subject" ||
              (row.actor && hasFullCaseScope(row.actor.shareScope)),
          )
          .map(({ case: record, subject }) => ({
            ...record,
            subject: {
              id: subject.id,
              displayName: subject.displayName,
              relationToUser: subject.relationToUser,
            },
          }));
      }),
    get: (caseId: string) =>
      caseOperation(() =>
        db.transaction(async (tx) => {
          z.uuid().parse(caseId);
          const record = await authorizeCase(tx, caseId, userId, false, sessionId);
          const steps = await tx
            .select()
            .from(caseSteps)
            .where(eq(caseSteps.caseId, caseId))
            .orderBy(asc(caseSteps.createdAt), asc(caseSteps.id));
          const deadlines = await tx
            .select()
            .from(reminders)
            .where(eq(reminders.caseId, caseId))
            .orderBy(asc(reminders.dueAt), asc(reminders.id));
          return {
            ...record.case,
            journeyMap: steps.map((step) => ({
              ...step,
              dueAt: step.dueAt?.toISOString() ?? null,
              createdAt: step.createdAt.toISOString(),
            })),
            subject: record.subject,
            steps,
            reminders: deadlines,
          };
        }),
      ),
    history: (caseId: string) =>
      caseOperation(() =>
        db.transaction(async (tx) => {
          z.uuid().parse(caseId);
          await authorizeCase(tx, caseId, userId, false, sessionId);
          return readCaseHistory(tx, caseId, userId);
        }),
      ),
    update: (caseId: string, raw: unknown, recordEvent = true) =>
      caseOperation(() =>
        db.transaction(async (tx) => {
          z.uuid().parse(caseId);
          const patch = casePatchSchema.parse(raw);
          await authorizeCase(tx, caseId, userId, true);
          if (recordEvent) await requireIdleCase(tx, caseId);
          if (Object.keys(patch).length > 0) {
            await tx.update(cases).set(patch).where(eq(cases.id, caseId));
            await tx
              .insert(auditEvents)
              .values({ actorId: userId, action: "case.updated", target: { caseId } });
          }
          const events: CaseEvent[] = [];
          if (patch.confirmedGoal !== undefined)
            events.push({ caseId, kind: "goal_confirmed", payload: { goal: patch.confirmedGoal } });
          if (recordEvent) for (const event of events) await appendCaseEvent(tx, event);
          return events;
        }),
      ),
    saveStep: (caseId, raw, stepId, evidence) =>
      caseOperation(() =>
        db.transaction((tx) => saveCaseStep(tx, userId, caseId, raw, stepId, evidence)),
      ),
  };
}
