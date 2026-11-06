import type { DatabaseClient } from "@lotse/db";
import {
  approvals,
  auditEvents,
  caseActors,
  caseSteps,
  cases,
  documents,
  facts,
  formInstances,
  helperInvites,
  helperSessions,
  jobs,
  messages,
  profiles,
  reminders,
  sessions,
  subjects,
  turns,
  users,
} from "@lotse/db/schema";
import { and, asc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { zipSync } from "fflate";
import { z } from "zod";
import { CASE_FILE_CONFIG } from "../config/index.ts";
import {
  CaseFileError,
  type CaseTransaction,
  caseOperation,
  type ObjectStorage,
} from "./schema.ts";

async function authorizedSubjects(tx: CaseTransaction, userId: string, subjectId?: string) {
  if (subjectId !== undefined) z.uuid().parse(subjectId);
  const subjectCases = tx
    .select({ subjectId: cases.subjectId })
    .from(cases)
    .innerJoin(caseActors, eq(caseActors.caseId, cases.id))
    .where(and(eq(caseActors.userId, userId), eq(caseActors.role, "subject")));
  const rows = await tx
    .select()
    .from(subjects)
    .where(
      and(
        or(eq(subjects.createdBy, userId), inArray(subjects.id, subjectCases)),
        subjectId ? eq(subjects.id, subjectId) : undefined,
      ),
    )
    .orderBy(asc(subjects.id))
    .for("update");
  if (subjectId && rows.length === 0) throw new CaseFileError("access_denied");
  return rows;
}

async function collectData(tx: CaseTransaction, userId: string, subjectId?: string) {
  // A concurrent subject/session creation takes a key-share lock on this user.
  // Freeze that membership before enumerating objects for account export/deletion.
  if (subjectId === undefined)
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  const people = await authorizedSubjects(tx, userId, subjectId);
  const subjectIds = people.map((row) => row.id);
  const caseRows = await tx
    .select()
    .from(cases)
    .where(inArray(cases.subjectId, subjectIds))
    .orderBy(asc(cases.id))
    .for("update");
  const caseIds = caseRows.map((row) => row.id);
  const actorRows = await tx.select().from(caseActors).where(inArray(caseActors.caseId, caseIds));
  const actorIds = actorRows.map((row) => row.id);
  const storedDocuments = await tx
    .select()
    .from(documents)
    .where(inArray(documents.subjectId, subjectIds));
  const instances = await tx
    .select()
    .from(formInstances)
    .where(
      or(inArray(formInstances.subjectId, subjectIds), inArray(formInstances.caseId, caseIds)),
    );
  const approvalRows = await tx.select().from(approvals).where(inArray(approvals.caseId, caseIds));
  // HMACs and bearer/invite hashes are execution credentials, not portable user context.
  const safeApprovals = approvalRows.map(({ hmac: _hmac, ...row }) => row);
  const invites = await tx
    .select()
    .from(helperInvites)
    .where(inArray(helperInvites.caseId, caseIds));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    subjects: people,
    cases: caseRows,
    actors: actorRows,
    documents: storedDocuments,
    formInstances: instances,
    facts: await tx.select().from(facts).where(inArray(facts.subjectId, subjectIds)),
    steps: await tx.select().from(caseSteps).where(inArray(caseSteps.caseId, caseIds)),
    messages: await tx
      .select()
      .from(messages)
      .where(inArray(messages.caseId, caseIds))
      .orderBy(asc(messages.caseId), asc(messages.position)),
    approvals: safeApprovals,
    turns: await tx.select().from(turns).where(inArray(turns.caseId, caseIds)),
    reminders: await tx.select().from(reminders).where(inArray(reminders.caseId, caseIds)),
    jobs: await tx.select().from(jobs).where(inArray(jobs.caseId, caseIds)),
    helperSessions: await tx
      .select()
      .from(helperSessions)
      .where(inArray(helperSessions.caseId, caseIds)),
    helperInvites: invites.map(({ tokenHash: _tokenHash, ...row }) => row),
    account:
      subjectId === undefined ? await tx.select().from(users).where(eq(users.id, userId)) : [],
    sessions:
      subjectId === undefined
        ? await tx.select().from(sessions).where(eq(sessions.userId, userId))
        : [],
    auditEvents: await tx
      .select()
      .from(auditEvents)
      .where(
        or(
          inArray(auditEvents.actorId, actorIds),
          sql`${auditEvents.target}->>'caseId' IN ${
            caseIds.length
              ? sql`(${sql.join(
                  caseIds.map((id) => sql`${id}`),
                  sql`,`,
                )})`
              : sql`(NULL)`
          }`,
          sql`${auditEvents.target}->>'subjectId' IN ${
            subjectIds.length
              ? sql`(${sql.join(
                  subjectIds.map((id) => sql`${id}`),
                  sql`,`,
                )})`
              : sql`(NULL)`
          }`,
          subjectId === undefined ? eq(auditEvents.actorId, userId) : undefined,
        ),
      )
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id)),
    profile:
      subjectId === undefined
        ? await tx.select().from(profiles).where(eq(profiles.userId, userId))
        : [],
  };
}

export interface PortabilityService {
  export(subjectId?: string): Promise<Uint8Array>;
  delete(subjectId?: string): Promise<{ deletedSubjects: string[]; retainedAudit: true }>;
}

export function createPortabilityService(
  db: DatabaseClient,
  storage: ObjectStorage,
  authenticatedUserId: string,
): PortabilityService {
  const userId = z.uuid().parse(authenticatedUserId);
  return {
    export: (subjectId?: string) =>
      caseOperation(() =>
        db.transaction(
          async (tx) => {
            const data = await collectData(tx, userId, subjectId);
            const files: Record<string, Uint8Array> = {};
            const manifest: { path: string; storageKey: string }[] = [];
            for (const document of data.documents) {
              const path = `documents/${document.id}`;
              files[path] = await storage.get(document.storageKey);
              manifest.push({ path, storageKey: document.storageKey });
            }
            for (const form of data.formInstances) {
              if (!form.outputKey) continue;
              const path = `forms/${form.id}.pdf`;
              files[path] = await storage.get(form.outputKey);
              manifest.push({ path, storageKey: form.outputKey });
            }
            files["data.json"] = Buffer.from(JSON.stringify({ ...data, files: manifest }, null, 2));
            return zipSync(files, { level: CASE_FILE_CONFIG.zipLevel });
          },
          { isolationLevel: "repeatable read" },
        ),
      ),
    delete: (subjectId?: string) =>
      caseOperation(() =>
        db.transaction(async (tx) => {
          const data = await collectData(tx, userId, subjectId);
          const keys = new Set([
            ...data.documents.map((document) => document.storageKey),
            ...data.formInstances.flatMap((instance) =>
              instance.outputKey ? [instance.outputKey] : [],
            ),
          ]);
          const ids = data.subjects.map((subject) => subject.id);
          const caseIds = data.cases.map((record) => record.id);
          // Deduplicated uploads may share an object with another subject. Keep that object.
          const otherDocuments = await tx
            .select({ key: documents.storageKey })
            .from(documents)
            .where(
              and(notInArray(documents.subjectId, ids), inArray(documents.storageKey, [...keys])),
            );
          const otherOutputs = await tx
            .select({ key: formInstances.outputKey })
            .from(formInstances)
            .where(
              and(
                notInArray(formInstances.subjectId, ids),
                notInArray(formInstances.caseId, caseIds),
                inArray(formInstances.outputKey, [...keys]),
              ),
            );
          for (const row of [...otherDocuments, ...otherOutputs]) if (row.key) keys.delete(row.key);
          // Storage first: failed deletion retains DB references so the same request can be retried.
          // S3 DeleteObject is idempotent, including keys already removed by a previous attempt.
          for (const key of keys) await storage.delete(key);
          await tx.delete(subjects).where(inArray(subjects.id, ids));
          if (subjectId === undefined) await tx.delete(users).where(eq(users.id, userId));
          // Audit is append-only by DB trigger. It retains only opaque identifiers, never context.
          return { deletedSubjects: ids, retainedAudit: true as const };
        }),
      ),
  };
}
