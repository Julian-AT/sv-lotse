import { createHash } from "node:crypto";
import type { Database } from "@lotse/db";
import { z } from "zod";
import { extractDatedObligations } from "./extract.ts";
import { DeadlineError, type Reminder, reminderSchema } from "./schema.ts";

const syncInput = z.object({
  caseId: z.uuid(),
  stepSources: z.array(
    z.object({
      stepId: z.uuid(),
      title: z.string().trim().min(1),
      sourceQuote: z.string().refine((quote) => quote.trim().length > 0),
    }),
  ),
});
const storedFacts = z.array(
  z.object({
    id: z.uuid(),
    confirmed: z.boolean(),
    value: z.unknown(),
    source: z.record(z.string(), z.json()),
  }),
);
const storedDate = z.union([z.date(), z.string()]).pipe(z.coerce.date());
const storedReminder = reminderSchema.extend({ dueAt: storedDate, createdAt: storedDate });
const storedSteps = z.array(
  z.object({
    id: z.uuid(),
    dueAt: storedDate.nullable(),
    status: z.enum(["pending", "in_progress", "blocked", "completed"]),
  }),
);

// UUIDv8: domain-separated SHA-256 identity, independent of due date or wording.
function reminderId(caseId: string, key: string): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify(["deadline", caseId, key]))
    .digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Internal server API: caller must authorize access to the case before calling.
 * Reconciles only reminders owned by this guard. Undated/unconfirmed facts are ignored.
 * Step sources come from the process definition, never from generated text.
 */
export async function syncCaseDeadlines(
  database: Database,
  input: z.input<typeof syncInput>,
): Promise<Reminder[]> {
  const { caseId, stepSources } = syncInput.parse(input);
  return database.sql
    .begin(async (sql) => {
      // Serialize reconciliation for this case, including deletion of obsolete obligations.
      const [caseRow] = await sql`SELECT id FROM "case" WHERE id = ${caseId} FOR UPDATE`;
      if (!caseRow) throw new DeadlineError("case_not_found");
      const facts = storedFacts.parse(
        await sql`
      SELECT f.id, f.confirmed, f.value, f.source FROM fact f
      JOIN "case" c ON c.subject_id = f.subject_id
      WHERE c.id = ${caseId} AND f.confirmed = true`,
      );
      const rows = storedSteps.parse(
        await sql`
      SELECT id, status, due_at AS "dueAt" FROM case_step WHERE case_id = ${caseId}`,
      );
      const steps = rows.flatMap((step) => {
        const source = stepSources.find((entry) => entry.stepId === step.id);
        return source ? [{ ...step, title: source.title, sourceQuote: source.sourceQuote }] : [];
      });
      const obligations = extractDatedObligations({ facts, steps });
      const ids = obligations.map((obligation) => reminderId(caseId, obligation.key));
      await sql`DELETE FROM reminder WHERE case_id = ${caseId}
      AND source->>'kind' = 'deadline' AND NOT (id = ANY(${ids}::uuid[]))`;
      for (const obligation of obligations) {
        await sql`INSERT INTO reminder (id, case_id, due_at, source)
        VALUES (${reminderId(caseId, obligation.key)}, ${caseId}, ${obligation.dueAt.toISOString()},
          ${JSON.stringify(obligation.source)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET due_at = EXCLUDED.due_at, source = EXCLUDED.source`;
      }
      return parseReminders(
        await sql`SELECT id, case_id AS "caseId", due_at AS "dueAt",
      created_at AS "createdAt", source FROM reminder
      WHERE case_id = ${caseId} AND source->>'kind' = 'deadline' ORDER BY due_at, id`,
      );
    })
    .catch(rethrowPersistenceError);
}

function rethrowPersistenceError(error: unknown): never {
  if (error instanceof DeadlineError) throw error;
  throw new DeadlineError("persistence_failed");
}

function parseReminders(rows: unknown): Reminder[] {
  const result = z.array(storedReminder).safeParse(rows);
  if (!result.success) throw new DeadlineError("invalid_reminder");
  return result.data;
}

/** Read the guard's reminders only. Call sync after facts or steps change. */
export async function listCaseReminders(database: Database, caseId: string): Promise<Reminder[]> {
  const id = z.uuid().parse(caseId);
  return parseReminders(
    await database.sql`SELECT id, case_id AS "caseId", due_at AS "dueAt",
    created_at AS "createdAt", source FROM reminder
    WHERE case_id = ${id} AND source->>'kind' = 'deadline' ORDER BY due_at, id`.catch(
      rethrowPersistenceError,
    ),
  );
}
