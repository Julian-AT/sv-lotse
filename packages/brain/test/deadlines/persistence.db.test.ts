import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { listCaseReminders, syncCaseDeadlines } from "@lotse/brain/deadlines";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

const envPath = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);
const admin = createDatabase();
const databaseName = `deadline_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(admin.config.DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabase({ ...process.env, DATABASE_URL: databaseUrl.href });
let created = false;
const userId = randomUUID();
const subjectId = randomUUID();
const caseId = randomUUID();
const factId = randomUUID();
const stepId = randomUUID();
const quote = "Bitte reichen Sie die Unterlagen bis 29.03.2026 ein.";
const stepSources = [
  { stepId, title: "Nachreichen", sourceQuote: "Unterlagen bis zum Termin nachreichen." },
];

beforeAll(async () => {
  await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
  created = true;
  await migrateDatabase(database);
  // Synthetic dated administrative facts; all persistence uses real Postgres.
  await database.sql`INSERT INTO "user" (id) VALUES (${userId})`;
  await database.sql`INSERT INTO subject (id, display_name, relation_to_user, created_by)
    VALUES (${subjectId}, 'Testperson', 'self', ${userId})`;
  await database.sql`INSERT INTO "case" (id, subject_id, confirmed_goal)
    VALUES (${caseId}, ${subjectId}, 'Unterlagen einreichen')`;
  const [turn] = await database.sql<{ id: string }[]>`INSERT INTO turn (case_id)
    VALUES (${caseId}) RETURNING id`;
  if (!turn) throw new Error("Missing fixture turn");
  await database.sql`INSERT INTO fact (id, subject_id, type, value, turn_id, source, confidence, confirmed)
    VALUES (${factId}, ${subjectId}, 'deadline',
      ${JSON.stringify({ title: "Einreichen", dueAt: "2026-03-29" })}::jsonb, ${turn.id},
      ${JSON.stringify({ quote, turnId: turn.id })}::jsonb, 1, true)`;
  await database.sql`INSERT INTO case_step (id, case_id, process_step, owner, initiated_by, due_at)
    VALUES (${stepId}, ${caseId}, 'follow_up', 'user', 'pilot', '2026-04-01T08:00:00Z')`;
}, 30000);

beforeEach(async () => {
  await database.sql`DELETE FROM reminder WHERE case_id = ${caseId}`;
  await database.sql`UPDATE fact SET confirmed = true,
    value = ${JSON.stringify({ title: "Einreichen", dueAt: "2026-03-29" })}::jsonb
    WHERE id = ${factId}`;
  await database.sql`UPDATE case_step SET status = 'pending' WHERE id = ${stepId}`;
});

afterAll(async () => {
  await database.close();
  try {
    if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)}`;
  } finally {
    await admin.close();
  }
});

test("AC1 concurrent and repeated extraction creates one reminder per obligation in Postgres", async () => {
  const runs = await Promise.all(
    Array.from({ length: 6 }, () => syncCaseDeadlines(database, { caseId, stepSources })),
  );
  const [first] = runs;
  expect(first).toHaveLength(2);
  for (const run of runs) expect(run).toEqual(first);
  expect(await database.sql`SELECT id FROM reminder WHERE case_id = ${caseId}`).toHaveLength(2);
  expect(first?.find((reminder) => reminder.source.key === `fact:${factId}`)).toMatchObject({
    dueAt: new Date("2026-03-29T21:59:59.999Z"),
    source: { sourceQuote: quote },
  });
});

test("updates an obligation without changing its identity and removes retracted or completed obligations", async () => {
  const initial = await syncCaseDeadlines(database, { caseId, stepSources });
  await database.sql`UPDATE fact SET value = ${JSON.stringify({ title: "Neue Frist", dueAt: "2026-04-02" })}::jsonb WHERE id = ${factId}`;
  const updated = await syncCaseDeadlines(database, { caseId, stepSources });
  const previous = initial.find((reminder) => reminder.source.key === `fact:${factId}`);
  expect(updated.find((reminder) => reminder.id === previous?.id)).toMatchObject({
    dueAt: new Date("2026-04-02T21:59:59.999Z"),
    source: { title: "Neue Frist", sourceQuote: quote },
  });
  await database.sql`UPDATE fact SET confirmed = false WHERE id = ${factId}`;
  await database.sql`UPDATE case_step SET status = 'completed' WHERE id = ${stepId}`;
  await database.sql`INSERT INTO reminder (case_id, due_at, source)
    VALUES (${caseId}, '2026-01-01Z', '{"quote":"Legacy reminder"}'::jsonb)`;
  expect(await syncCaseDeadlines(database, { caseId, stepSources })).toEqual([]);
  expect(await listCaseReminders(database, caseId)).toEqual([]);
  expect(await database.sql`SELECT source FROM reminder WHERE case_id = ${caseId}`).toEqual([
    { source: { quote: "Legacy reminder" } },
  ]);
});

test("does not extract another subject's facts or another case's steps", async () => {
  const otherSubject = randomUUID();
  const otherCase = randomUUID();
  const otherStep = randomUUID();
  await database.sql`INSERT INTO subject (id, display_name, relation_to_user, created_by)
    VALUES (${otherSubject}, 'Andere Testperson', 'self', ${userId})`;
  await database.sql`INSERT INTO "case" (id, subject_id, confirmed_goal)
    VALUES (${otherCase}, ${otherSubject}, 'Unterlagen einreichen')`;
  await database.sql`INSERT INTO case_step (id, case_id, process_step, owner, initiated_by, due_at)
    VALUES (${otherStep}, ${otherCase}, 'follow_up', 'user', 'pilot', '2026-04-01T08:00:00Z')`;
  expect(await syncCaseDeadlines(database, { caseId: otherCase, stepSources })).toEqual([]);
  expect(await listCaseReminders(database, caseId)).toEqual([]);
});

test("rejects a nonexistent case with a content-free typed error", async () => {
  await expect(
    syncCaseDeadlines(database, { caseId: randomUUID(), stepSources: [] }),
  ).rejects.toMatchObject({
    name: "DeadlineError",
    code: "case_not_found",
    message: "case_not_found",
  });
});
