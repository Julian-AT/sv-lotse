import { createHash } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { caseActors, cases, facts, reminders } from "@lotse/db/schema";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { extractDatedObligations } from "./extract.ts";
import { reminderId } from "./identity.ts";
import {
  analyzeLetter,
  explainLetterAnalysis,
  type LetterExplanation,
  readLetterPages,
} from "./letter.ts";
import { assertCurrentLetter, readStoredLetter, type StoredLetter } from "./letter-store.ts";
import {
  DeadlineError,
  deadlineDate,
  type Obligation,
  type Reminder,
  reminderSchema,
} from "./schema.ts";
import { endOfViennaDate } from "./time.ts";

type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

const createInput = z.object({
  caseId: z.uuid(),
  dueAt: deadlineDate,
  title: z.string().trim().min(1),
  sourceQuote: z.string().refine((quote) => quote.trim().length > 0),
});
const extractInput = z.object({ caseId: z.uuid(), documentId: z.uuid().optional() });
type AnalyzedLetter = { document: StoredLetter; explanation: LetterExplanation };

export type DeadlineExtraction = {
  reminders: Reminder[];
  unresolvedDeadlines: LetterExplanation["deadlines"];
};

export interface DeadlineService {
  explainLetter(
    caseId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<LetterExplanation>;
  list(caseId: string): Promise<Reminder[]>;
  create(input: z.input<typeof createInput>): Promise<Reminder>;
  extract(input: z.input<typeof extractInput>, signal?: AbortSignal): Promise<DeadlineExtraction>;
}

async function deadlineOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DeadlineError) throw error;
    if (error instanceof z.ZodError) throw new DeadlineError("invalid_input");
    throw new DeadlineError("persistence_failed");
  }
}

/** Calendar and letters can contain all subject facts: only the persisted subject actor may read them. */
async function authorizeCase(tx: Transaction, userId: string, caseId: string): Promise<string> {
  const [record] = await tx
    .select({ subjectId: cases.subjectId })
    .from(cases)
    .innerJoin(
      caseActors,
      and(
        eq(caseActors.caseId, cases.id),
        eq(caseActors.userId, userId),
        eq(caseActors.role, "subject"),
      ),
    )
    .where(eq(cases.id, caseId))
    .for("update", { of: cases });
  if (!record) throw new DeadlineError("access_denied");
  return record.subjectId;
}

async function saveObligations(
  tx: Transaction,
  caseId: string,
  obligations: readonly Obligation[],
): Promise<void> {
  for (const obligation of obligations) {
    const source = z.record(z.string(), z.json()).parse(obligation.source);
    await tx
      .insert(reminders)
      .values({
        id: reminderId(caseId, obligation.key),
        caseId,
        dueAt: obligation.dueAt,
        source,
      })
      .onConflictDoUpdate({ target: reminders.id, set: { dueAt: obligation.dueAt, source } });
  }
}

function normalizeReminder(row: typeof reminders.$inferSelect): Reminder | undefined {
  const parsed = reminderSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  // Read reminders written by the original reminder.create without losing their source quotes.
  const legacy = z
    .object({ title: z.string().min(1), quote: z.string().min(1) })
    .safeParse(row.source);
  if (!legacy.success) return undefined;
  return reminderSchema.parse({
    ...row,
    source: {
      kind: "manual",
      key: `legacy:${row.id}`,
      title: legacy.data.title,
      sourceQuote: legacy.data.quote,
      provenance: {},
    },
  });
}

async function readReminders(tx: Transaction, caseId: string): Promise<Reminder[]> {
  const rows = await tx
    .select()
    .from(reminders)
    .where(eq(reminders.caseId, caseId))
    .orderBy(asc(reminders.dueAt), asc(reminders.id));
  return rows.flatMap((row) => {
    const reminder = normalizeReminder(row);
    return reminder ? [reminder] : [];
  });
}

/** Identity is server authenticated. No user or subject identity is accepted in tool/HTTP input. */
export function createDeadlineService(
  database: DatabaseClient,
  authenticatedUserId: string,
): DeadlineService {
  const userId = z.uuid().parse(authenticatedUserId);

  async function withCase<T>(
    caseId: string,
    operation: (tx: Transaction, subjectId: string) => Promise<T>,
  ): Promise<T> {
    return deadlineOperation(() =>
      database.transaction(async (tx) => {
        z.uuid().parse(caseId);
        const subjectId = await authorizeCase(tx, userId, caseId);
        return operation(tx, subjectId);
      }),
    );
  }

  async function analyzeStoredLetter(
    caseId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<AnalyzedLetter> {
    const document = await withCase(caseId, (tx, subjectId) =>
      readStoredLetter(tx, subjectId, documentId),
    );
    const analysis = await analyzeLetter(readLetterPages(document.pages), signal);
    return { document, explanation: explainLetterAnalysis(documentId, analysis) };
  }

  return {
    explainLetter: async (
      caseId: string,
      documentId: string,
      signal?: AbortSignal,
    ): Promise<LetterExplanation> => {
      const analyzed = await analyzeStoredLetter(caseId, documentId, signal);
      await withCase(caseId, (tx, subjectId) =>
        assertCurrentLetter(tx, subjectId, analyzed.document),
      );
      return analyzed.explanation;
    },
    list: (caseId: string): Promise<Reminder[]> =>
      withCase(caseId, (tx) => readReminders(tx, caseId)),
    create: (raw: z.input<typeof createInput>): Promise<Reminder> =>
      deadlineOperation(async () => {
        const input = createInput.parse(raw);
        return withCase(input.caseId, async (tx) => {
          const key = `manual:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
          const dateOnly = !input.dueAt.includes("T");
          const obligation: Obligation = {
            key,
            dueAt: dateOnly ? endOfViennaDate(input.dueAt) : new Date(input.dueAt),
            source: {
              kind: "manual",
              key,
              title: input.title,
              sourceQuote: input.sourceQuote,
              ...(dateOnly ? { date: input.dueAt } : {}),
              provenance: {},
            },
          };
          await saveObligations(tx, input.caseId, [obligation]);
          const row = (await readReminders(tx, input.caseId)).find(
            (entry) => entry.id === reminderId(input.caseId, key),
          );
          if (!row) throw new DeadlineError("persistence_failed");
          return row;
        });
      }),
    extract: (
      raw: z.input<typeof extractInput>,
      signal?: AbortSignal,
    ): Promise<DeadlineExtraction> =>
      deadlineOperation(async () => {
        const { caseId, documentId } = extractInput.parse(raw);
        const analyzed = documentId
          ? await analyzeStoredLetter(caseId, documentId, signal)
          : undefined;
        const letter = analyzed?.explanation;
        return withCase(caseId, async (tx, subjectId) => {
          if (analyzed) await assertCurrentLetter(tx, subjectId, analyzed.document);
          const confirmedFacts = await tx
            .select()
            .from(facts)
            .where(and(eq(facts.subjectId, subjectId), eq(facts.confirmed, true)));
          const obligations = extractDatedObligations({ facts: confirmedFacts, steps: [] });
          // Reconcile only fact obligations. Process-step, manual and other document reminders survive.
          const ids = obligations.map((entry) => reminderId(caseId, entry.key));
          await tx
            .delete(reminders)
            .where(
              and(
                eq(reminders.caseId, caseId),
                sql`${reminders.source}->>'kind' = 'deadline'`,
                sql`starts_with(${reminders.source}->>'key', 'fact:')`,
                ids.length ? notInArray(reminders.id, ids) : undefined,
              ),
            );
          if (letter && documentId) {
            for (const deadline of letter.deadlines) {
              if (!deadline.dueAt) continue;
              const key = `letter:${documentId}:${deadline.page}:${createHash("sha256").update(deadline.quote).digest("hex")}`;
              obligations.push({
                key,
                dueAt: endOfViennaDate(deadline.dueAt),
                source: {
                  kind: "letter",
                  key,
                  title: deadline.title,
                  sourceQuote: deadline.quote,
                  date: deadline.dueAt,
                  provenance: { documentId, page: deadline.page, quote: deadline.quote },
                },
              });
            }
          }
          if (documentId) {
            const letterIds = obligations
              .filter((entry) => entry.source.kind === "letter")
              .map((entry) => reminderId(caseId, entry.key));
            await tx
              .delete(reminders)
              .where(
                and(
                  eq(reminders.caseId, caseId),
                  sql`${reminders.source}->>'kind' = 'letter'`,
                  sql`${reminders.source}->'provenance'->>'documentId' = ${documentId}`,
                  letterIds.length ? notInArray(reminders.id, letterIds) : undefined,
                ),
              );
          }
          await saveObligations(tx, caseId, obligations);
          return {
            reminders: await readReminders(tx, caseId),
            unresolvedDeadlines: letter?.deadlines.filter((entry) => !entry.dueAt) ?? [],
          };
        });
      }),
  };
}
