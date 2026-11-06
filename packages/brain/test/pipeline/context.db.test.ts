import { randomUUID } from "node:crypto";
import {
  caseSteps,
  cases,
  documents,
  facts,
  formInstances,
  formTemplates,
  processes,
  turns,
} from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { assembleContext, loadTurnState } from "../../src/context/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import { preparePipeline } from "../../src/pipeline/index.ts";
import { config, identity, isolatedDatabase, turn } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.cleanup();
});
it("an authenticated approval continuation assembles persisted context without a classifier or embedding call", async () => {
  const session = await identity(database.db);
  const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
  await database.db
    .update(cases)
    .set({ confirmedGoal: "Unterlagen vorbereiten" })
    .where(eq(cases.id, context.caseId));
  const history = [{ id: randomUUID(), role: "assistant" as const, parts: [] }];
  const result = await preparePipeline({
    db: database.db,
    config,
    context,
    turnId: randomUUID(),
    request: turn,
    history,
  });
  expect(result.confirmed).toBe(true);
  if (!result.confirmed) throw new Error("CONTINUATION_NOT_PREPARED");
  expect(result.passages).toEqual([]);
  expect(result.history).toEqual(history);
  expect(result.blocks.case).toContain(context.caseId);
  expect(await result.refreshContext()).toContain(context.caseId);
});
it("context assembly selects only confirmed facts needed by the active step and allowed by share scope", async () => {
  const session = await identity(database.db);
  const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
  const documentId = randomUUID();
  await database.db.insert(documents).values({
    id: documentId,
    subjectId: context.subjectId,
    type: "application/pdf",
    storageKey: `test/${documentId}`,
    hash: "test-context-document",
    pages: [],
    ocrStatus: "completed",
    originClient: "web",
  });
  const turnId = randomUUID();
  await database.db.insert(turns).values({ id: turnId, caseId: context.caseId });
  await database.db.insert(processes).values({
    key: "synthetic-context-process",
    title: "Administrative preparation",
    record: {
      id: "synthetic-context-process",
      slots: [
        {
          id: "required-slot",
          type: "fact:required-fact",
          question_hint: "Confirm the administrative value",
        },
        {
          id: "unrelated-slot",
          type: "fact:unrelated-fact",
          question_hint: "A different question",
        },
      ],
      steps: [{ id: "synthetic-active-step", needs: ["required-slot"] }],
    },
  });
  await database.db.insert(caseSteps).values({
    caseId: context.caseId,
    processStep: "synthetic-active-step",
    status: "in_progress",
    owner: "pilot",
    initiatedBy: "user",
  });
  for (const [type, value, confirmed] of [
    ["required-fact", "visible-confirmed-value", true],
    ["required-fact", "unconfirmed-private-value", false],
    ["unrelated-fact", "unrelated-private-value", true],
  ] as const)
    await database.db.insert(facts).values({
      subjectId: context.subjectId,
      turnId,
      type,
      value,
      confirmed,
      source: { quote: value },
      confidence: 1,
    });
  const templateId = randomUUID();
  const instanceId = randomUUID();
  // Test-only administrative registry metadata; no fake asset is used by product code.
  await database.db.insert(formTemplates).values({
    id: templateId,
    title: "Administrative form",
    publisher: "Test fixture",
    source: "svbox:context-fixture.pdf",
    hash: "test-only",
    format: "flat",
    pages: 1,
    schema: { fields: [] },
    storageKey: "test-only",
  });
  await database.db.insert(formInstances).values({
    id: instanceId,
    caseId: context.caseId,
    subjectId: context.subjectId,
    templateId,
    fields: {},
  });
  const state = await loadTurnState(database.db, context);
  const result = await assembleContext(database.db, context, state, ["unrelated-fact"], {}, [], []);
  expect(result.blocks.case).toContain(context.caseId);
  expect(result.blocks.case).toContain(context.subjectId);
  expect(result.blocks.case).toContain(documentId);
  expect(result.blocks.case).not.toContain(`test/${documentId}`);
  // Tools require these authenticated references; the model must not invent them.
  expect(JSON.parse(result.blocks.case)[0]).toMatchObject({
    caseId: context.caseId,
    subjectId: context.subjectId,
  });
  expect(result.blocks.case).not.toContain(context.sessionId);
  expect(result.blocks.case).not.toContain(context.userId);
  expect(result.blocks.case).toContain(instanceId);
  expect(result.blocks.facts).toContain("visible-confirmed-value");
  expect(result.blocks.facts).not.toContain("unconfirmed-private-value");
  expect(result.blocks.facts).not.toContain("unrelated-private-value");
  const helper = {
    ...context,
    actorRole: "helper" as const,
    shareScope: { facts: ["unrelated-fact"] },
  };
  const restricted = await assembleContext(
    database.db,
    helper,
    state,
    ["unrelated-fact"],
    {},
    [],
    [],
  );
  expect(JSON.parse(restricted.blocks.facts)).toEqual([]);
  expect(restricted.blocks.case).not.toContain(documentId);
  expect(restricted.blocks.case).not.toContain(instanceId);
  expect((await loadTurnState(database.db, helper)).forms).toEqual([]);
});
