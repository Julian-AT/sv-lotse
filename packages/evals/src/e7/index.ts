import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { getFormSchema, getTemplate, prefillForm, type RuntimeContext } from "@lotse/brain/forms";
import { createDatabase, type Database } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import {
  caseActors,
  cases,
  documents,
  facts,
  formFields,
  formTemplates,
  sessions,
  subjects,
  turns,
  users,
} from "@lotse/db/schema";
import { z } from "zod";
import { E7_CONFIG } from "../config.ts";
import type { RegisteredSuite } from "../runner/index.ts";
import { E7ExpectedSchema, E7InputSchema, loadE7 } from "./data.ts";
import { reducePrefill, scorePrefill } from "./metrics.ts";

async function createContext(database: Database): Promise<RuntimeContext> {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    subjectId = randomUUID();
  const caseId = randomUUID(),
    actorId = randomUUID();
  await database.db.insert(users).values({ id: userId });
  await database.db.insert(sessions).values({
    id: sessionId,
    userId,
    clientKind: "web",
    expiresAt: new Date(Date.now() + E7_CONFIG.sessionLifetimeMs),
  });
  await database.db.insert(subjects).values({
    id: subjectId,
    createdBy: userId,
    displayName: "E7 synthetic applicant",
    relationToUser: "self",
  });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "E7 synthetic form evaluation" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId, role: "subject", shareScope: { mode: "full" } });
  return {
    userId,
    sessionId,
    subjectId,
    caseId,
    actorId,
    actorRole: "subject",
    autonomyLevel: "L2",
    shareScope: { mode: "full" },
    sentenceIndex: 0,
  };
}

async function storeFacts(
  database: Database,
  context: RuntimeContext,
  input: z.infer<typeof E7InputSchema>,
) {
  const turnId = randomUUID(),
    documentId = randomUUID();
  await database.db
    .insert(turns)
    .values({ id: turnId, caseId: context.caseId, status: "completed" });
  await database.db.insert(documents).values({
    id: documentId,
    subjectId: context.subjectId,
    type: "synthetic-e7-statement",
    storageKey: "e7/no-document-asset",
    hash: "e7-synthetic-facts",
    originClient: "web",
  });
  const rows = input.facts.map((fact) => ({
    id: randomUUID(),
    subjectId: context.subjectId,
    type: fact.type,
    value: fact.value,
    confirmed: fact.confirmed,
    confidence: 1,
    ...(fact.source === "statement" ? { turnId } : { documentId }),
    source: {
      kind: fact.source,
      quote: fact.quote,
      ...(fact.source === "statement" ? { turnId } : { documentId }),
    },
  }));
  // Test-only distractors prove confirmed-state and subject isolation on the real query path.
  const foreign = randomUUID();
  await database.db.insert(subjects).values({
    id: foreign,
    createdBy: context.userId,
    displayName: "E7 other synthetic subject",
    relationToUser: "other",
  });
  await database.db.insert(facts).values([
    ...rows,
    {
      subjectId: context.subjectId,
      type: "person.name",
      value: "Unconfirmed synthetic name",
      confirmed: false,
      confidence: 1,
      turnId,
      source: { kind: "statement", turnId, quote: "Unconfirmed synthetic name" },
    },
    {
      subjectId: foreign,
      type: "person.name",
      value: "Other synthetic subject",
      confirmed: true,
      confidence: 1,
      turnId,
      source: { kind: "statement", turnId, quote: "Other synthetic subject" },
    },
  ]);
  return new Map<string, (typeof rows)[number]>(rows.map((row) => [row.id, row]));
}

export async function e7Suite(): Promise<{
  definition: RegisteredSuite;
  close: () => Promise<void>;
}> {
  const data = await loadE7();
  const admin = createDatabase();
  const name = `lotse_e7_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${name}`;
  try {
    await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
  } catch {
    await admin.close();
    throw new Error("e7_database_unavailable");
  }
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  const close = async (): Promise<void> => {
    await database.close();
    try {
      await admin.sql`DROP DATABASE ${admin.sql(name)}`;
    } finally {
      await admin.close();
    }
  };
  try {
    await migrateDatabase(database);
    for (const form of data.forms)
      await database.db.insert(formTemplates).values({
        id: form.schema.template_id,
        publisher: form.publisher,
        title: form.schema.id,
        source: `svbox:${form.path}`,
        hash: form.sha256,
        format: "acroform",
        pages: form.pages,
        status: form.schema.status,
        schema: z.record(z.string(), z.json()).parse(form.schema),
        storageKey: `e7/${form.sha256}.pdf`,
      });
    // Analyze each shared template once before concurrent persona runs to avoid racing writes.
    for (const form of data.forms)
      await getFormSchema(database.db, await getTemplate(database.db, form.schema.template_id));
    return {
      close,
      definition: {
        suite: data.suite,
        cases: data.cases,
        reduce: reducePrefill,
        async execute(item, { signal }) {
          signal.throwIfAborted();
          const input = E7InputSchema.parse(item.input);
          const expected = E7ExpectedSchema.parse(item.expected);
          const form = data.forms.find((entry) => entry.schema.id === input.form);
          if (!form) throw new Error("e7_form_missing");
          const context = await createContext(database);
          const saved = await storeFacts(database, context, input);
          const output = await prefillForm(
            database.db,
            {
              templateId: form.schema.template_id,
              caseId: context.caseId,
              subjectId: context.subjectId,
            },
            context,
            signal,
          );
          const actual = E7ExpectedSchema.parse(
            Object.fromEntries(
              output.proposals.map((proposal) => [proposal.fieldId, proposal.value]),
            ),
          );
          const metrics = scorePrefill(expected, actual);
          let provenanceErrors = 0;
          for (const proposal of output.proposals) {
            const fact = proposal.provenance.factId
              ? saved.get(proposal.provenance.factId)
              : undefined;
            const field = form.schema.fields.find((entry) => entry.id === proposal.fieldId);
            if (
              !fact ||
              !field ||
              fact.type !== field.fact_type ||
              fact.value !== proposal.value ||
              fact.source.kind !== proposal.provenance.source.kind ||
              fact.source.quote !== proposal.provenance.source.quote ||
              ("turnId" in fact.source ? fact.source.turnId : undefined) !==
                proposal.provenance.source.turnId ||
              ("documentId" in fact.source ? fact.source.documentId : undefined) !==
                proposal.provenance.source.documentId
            )
              provenanceErrors++;
          }
          const [row] =
            await database.sql`SELECT fields FROM form_instance WHERE id = ${output.formInstanceId}`;
          const persisted = formFields.parse(row?.fields);
          const persistenceErrors =
            output.proposals.filter((proposal) => {
              const entry = persisted[proposal.fieldId];
              return (
                !entry ||
                entry.value !== proposal.value ||
                !isDeepStrictEqual(entry.provenance, proposal.provenance) ||
                entry.state !== "draft" ||
                entry.approvalId !== null
              );
            }).length + Math.abs(Object.keys(persisted).length - output.proposals.length);
          const missingErrors = form.schema.fields.filter(
            (field) =>
              field.owner === "applicant" &&
              field.signature === "none" &&
              field.type !== "signature" &&
              expected[field.id] === null &&
              !output.missingFields.includes(field.id),
          ).length;
          signal.throwIfAborted();
          return {
            passed:
              metrics.normalizedMatch === 1 &&
              metrics.blankAccuracy === 1 &&
              metrics.unexpectedProposals === 0 &&
              provenanceErrors === 0 &&
              persistenceErrors === 0 &&
              missingErrors === 0,
            metrics: { ...metrics, provenanceErrors, persistenceErrors, missingErrors },
          };
        },
      },
    };
  } catch {
    await close();
    throw new Error("e7_setup_failed");
  }
}
