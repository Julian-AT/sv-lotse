import { randomUUID } from "node:crypto";
import { caseActors, cases, profiles, sessions, subjects, turns, users } from "@lotse/db/schema";
import { JsonValueSchema, type TurnRequest } from "@lotse/protocol";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { type RuntimeContext, runtimeContextSchema } from "../agent/context.ts";
import type { Transaction } from "../approvals/index.ts";
import { TURN_LEASE_MS } from "../config/index.ts";
import { TurnError } from "./errors.ts";

export type SessionIdentity = { userId: string; sessionId: string; kind: "anonymous" };
export async function resolveContext(
  tx: Transaction,
  request: TurnRequest,
  session: SessionIdentity,
): Promise<RuntimeContext> {
  const [valid] = await tx
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, session.sessionId),
        eq(sessions.userId, session.userId),
        gt(sessions.expiresAt, sql`clock_timestamp()`),
      ),
    );
  if (!valid) throw new TurnError("CASE_ACCESS_DENIED", 403);
  let caseId = request.caseId;
  if (!caseId) {
    // Serialize self-subject creation, since its identity is not a schema unique key.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, session.userId)).for("update");
    let [subject] = await tx
      .select()
      .from(subjects)
      .where(and(eq(subjects.createdBy, session.userId), eq(subjects.relationToUser, "self")))
      .limit(1);
    if (request.subjectId && request.subjectId !== subject?.id)
      throw new TurnError("CASE_ACCESS_DENIED", 403);
    if (!subject)
      [subject] = await tx
        .insert(subjects)
        .values({ createdBy: session.userId, relationToUser: "self", displayName: "Ich" })
        .returning();
    if (!subject) throw new Error("Subject was not saved");
    caseId = randomUUID();
    await tx.insert(cases).values({ id: caseId, subjectId: subject.id, confirmedGoal: "" });
    await tx
      .insert(caseActors)
      .values({ caseId, userId: session.userId, role: "subject", shareScope: {} });
  }
  if (!z.uuid().safeParse(caseId).success) throw new TurnError("INVALID_TURN", 400);
  const [record] = await tx
    .select({ case: cases, actor: caseActors, subject: subjects, profile: profiles })
    .from(cases)
    .innerJoin(
      caseActors,
      and(eq(caseActors.caseId, cases.id), eq(caseActors.userId, session.userId)),
    )
    .innerJoin(subjects, eq(subjects.id, cases.subjectId))
    .leftJoin(
      profiles,
      and(eq(profiles.userId, subjects.createdBy), eq(subjects.relationToUser, "self")),
    )
    .where(eq(cases.id, caseId))
    .for("update", { of: cases });
  if (!record || (request.subjectId && request.subjectId !== record.subject.id))
    throw new TurnError("CASE_ACCESS_DENIED", 403);
  // A helper with screen-only scope cannot read or continue case history.
  if (record.actor.role === "helper" && record.actor.shareScope.case !== true)
    throw new TurnError("CASE_ACCESS_DENIED", 403);
  return runtimeContextSchema.parse({
    caseId,
    subjectId: record.subject.id,
    actorId: record.actor.id,
    actorRole: record.actor.role,
    userId: session.userId,
    sessionId: session.sessionId,
    autonomyLevel: record.profile?.autonomyLevel ?? "L1",
    shareScope: record.actor.shareScope,
    sentenceIndex: 0,
  });
}
export async function claimTurn(tx: Transaction, context: RuntimeContext, request: TurnRequest) {
  // A crashed process releases its bounded lease. Persisted steps and approvals
  // survive and can then be continued by a fresh process.
  const cutoff = new Date(Date.now() - TURN_LEASE_MS);
  const running = await tx
    .select()
    .from(turns)
    .where(and(eq(turns.caseId, context.caseId), eq(turns.status, "running")));
  if (running.some((turn) => turn.createdAt > cutoff)) throw new TurnError("TURN_IN_PROGRESS", 409);
  const [previous] = await tx
    .select()
    .from(turns)
    .where(eq(turns.caseId, context.caseId))
    .orderBy(desc(turns.createdAt))
    .limit(1);
  const recover =
    running.length > 0 ||
    previous?.status === "failed" ||
    previous?.status === "interrupted" ||
    (previous?.status === "awaiting_approval" && previous.createdAt <= cutoff);
  for (const turn of running)
    await tx.update(turns).set({ status: "interrupted" }).where(eq(turns.id, turn.id));
  const id = randomUUID();
  await tx.insert(turns).values({
    id,
    caseId: context.caseId,
    actionResults: request.actionResults.map((result) => JsonValueSchema.parse(result)),
  });
  return { turnId: id, recover };
}
export async function lockTurnClaim(
  tx: Transaction,
  caseId: string,
  turnId: string,
): Promise<void> {
  // The same case lock serializes takeover and every write. A previous process
  // cannot resume a save after its claim has been marked interrupted.
  await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId)).for("update");
  const [claim] = await tx
    .select({ status: turns.status })
    .from(turns)
    .where(and(eq(turns.id, turnId), eq(turns.caseId, caseId)));
  if (claim?.status !== "running") throw new TurnError("TURN_SUPERSEDED", 409);
}
