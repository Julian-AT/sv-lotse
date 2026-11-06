import type { DatabaseClient } from "@lotse/db";
import { caseActors, cases, messages, profiles, subjects, users } from "@lotse/db/schema";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { effectiveShareScope } from "../subjects/access.ts";
import { helperSessionAccess } from "../subjects/session-access.ts";
import { WorkspaceError } from "./schema.ts";

/** Bind only to identity obtained by requireSession. Subject actors own all writes. */
export function createConversationWorkspaceService(
  db: DatabaseClient,
  userId: string,
  sessionId?: string,
): ReturnType<typeof workspaceService> {
  return workspaceService(db, z.uuid().parse(userId), sessionId);
}

function workspaceService(db: DatabaseClient, userId: string, sessionId?: string) {
  const access = async (caseId: string) => {
    z.uuid().parse(caseId);
    const [record] = await db
      .select({ subjectId: cases.subjectId })
      .from(cases)
      .innerJoin(caseActors, eq(caseActors.caseId, cases.id))
      .where(
        and(eq(cases.id, caseId), eq(caseActors.userId, userId), eq(caseActors.role, "subject")),
      );
    if (!record) throw new WorkspaceError("CASE_ACCESS_DENIED");
    return record;
  };
  return {
    async listCases() {
      return db
        .select({
          role: caseActors.role,
          scope: caseActors.shareScope,
          id: cases.id,
          subjectId: cases.subjectId,
          confirmedGoal: cases.confirmedGoal,
          status: cases.status,
          autonomyLevel: profiles.autonomyLevel,
        })
        .from(cases)
        .innerJoin(caseActors, eq(caseActors.caseId, cases.id))
        .innerJoin(subjects, eq(subjects.id, cases.subjectId))
        .leftJoin(
          profiles,
          and(eq(profiles.userId, subjects.createdBy), eq(subjects.relationToUser, "self")),
        )
        .where(
          and(
            eq(caseActors.userId, userId),
            or(
              eq(caseActors.role, "subject"),
              helperSessionAccess(sql`${cases.id}`, userId, sessionId),
            ),
          ),
        )
        .orderBy(desc(cases.createdAt))
        .then((rows) =>
          rows
            .filter((row) => row.role === "subject" || effectiveShareScope(row.scope).case)
            .map(({ role: _role, scope: _scope, ...row }) => ({
              ...row,
              autonomyLevel: row.autonomyLevel ?? "L3",
            })),
        );
    },
    async createCase() {
      return db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
        let [subject] = await tx
          .select()
          .from(subjects)
          .where(and(eq(subjects.createdBy, userId), eq(subjects.relationToUser, "self")))
          .limit(1);
        if (!subject)
          [subject] = await tx
            .insert(subjects)
            .values({ createdBy: userId, relationToUser: "self", displayName: "" })
            .returning();
        if (!subject) throw new Error("SUBJECT_CREATE_FAILED");
        const [created] = await tx
          .insert(cases)
          .values({ subjectId: subject.id, confirmedGoal: "" })
          .returning();
        if (!created) throw new Error("CASE_CREATE_FAILED");
        await tx
          .insert(caseActors)
          .values({ caseId: created.id, userId, role: "subject", shareScope: {} });
        const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
        return {
          id: created.id,
          subjectId: created.subjectId,
          confirmedGoal: created.confirmedGoal,
          status: created.status,
          autonomyLevel: profile?.autonomyLevel ?? "L3",
        };
      });
    },
    async history(caseId: string) {
      await access(caseId);
      return (
        await db
          .select({ message: messages.uiMessage })
          .from(messages)
          .where(eq(messages.caseId, caseId))
          .orderBy(asc(messages.position))
      ).map((row) => row.message);
    },
  };
}
