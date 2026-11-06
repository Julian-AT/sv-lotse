import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  benefits,
  caseActors,
  caseSteps,
  cases,
  facts,
  messages,
  processes,
  reminders,
  subjects,
  turns,
  users,
} from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { createCaseFileService } from "../../src/case-file/service.ts";
import { createDeadlineService } from "../../src/deadlines/service.ts";
import { callDrafts } from "../../src/directory/prepare.ts";
import { contracts, type ToolName } from "../../src/tools/contracts/index.ts";
import { benefitRecordSchema } from "../../src/tools/contracts/records.ts";
import { buildTools } from "../../src/tools/registry.ts";
import { createWorkspaceService } from "../../src/workspace/service.ts";
import { isolatedDatabase } from "../runtime/helpers.ts";
import { definition, evidence } from "./fixtures.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let context: RuntimeContext;
let benefitKey: string;

beforeAll(async () => {
  database = await isolatedDatabase();
  const loaded = execFileSync("bun", ["run", "catalog:load"], {
    cwd: fileURLToPath(new URL("../../../knowledge/", import.meta.url)),
    env: { ...process.env, DATABASE_URL: database.config.DATABASE_URL },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(loaded).toContain("Catalog loaded.");
  const [benefit] = await database.db.select().from(benefits).limit(1);
  if (!benefit) throw new Error("Catalog loader returned no benefits");
  benefitKey = benefit.key;
  const userId = randomUUID();
  const subjectId = randomUUID();
  const caseId = randomUUID();
  const actorId = randomUUID();
  await database.db.insert(users).values({ id: userId });
  await database.db.insert(subjects).values({
    id: subjectId,
    displayName: "Testperson",
    relationToUser: "self",
    createdBy: userId,
  });
  await database.db.insert(cases).values({ id: caseId, subjectId, confirmedGoal: "" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId, role: "subject", shareScope: {} });
  await database.db.insert(turns).values({ caseId });
  context = {
    caseId,
    subjectId,
    actorId,
    userId,
    sessionId: randomUUID(),
    actorRole: "subject",
    autonomyLevel: "L1",
    shareScope: {},
    sentenceIndex: 0,
  };
}, 30000);

afterAll(async () => {
  await database?.cleanup();
});

async function execute(name: ToolName, input: unknown, ctx = context): Promise<unknown> {
  const tool = buildTools({ allowStubs: false, db: database.db })[name];
  if (!tool.execute) throw new Error("Missing server tool");
  const result = await tool.execute(input, {
    toolCallId: randomUUID(),
    messages: [],
    context: ctx,
  });
  expect(contracts[name].output.safeParse(result).success).toBe(true);
  return result;
}

it("FR-G1/FR-G2 reads the real loaded catalog, ranks a life situation and retains criterion sources", async () => {
  const record = benefitRecordSchema.parse(
    await execute("catalog.getBenefit", { benefitId: benefitKey }),
  );
  const result = contracts["catalog.findBenefits"].output.parse(
    await execute("catalog.findBenefits", {
      goalText: record.name_de,
      lifeSituation: record.life_situations[0],
      subject: {},
    }),
  );
  expect(result.some((item) => item.id === record.id)).toBe(true);
  expect(
    result.flatMap((item) => item.criteria).every((criterion) => criterion.sources.length > 0),
  ).toBe(true);
});

it("FR-G7 rejects an unconfirmed goal and unauthorized cases before starting", async () => {
  await expect(
    execute("process.start", { caseId: context.caseId, benefitId: benefitKey }),
  ).rejects.toMatchObject({ code: "GOAL_CONFIRMATION_REQUIRED" });
  await expect(
    execute("process.start", { caseId: randomUUID(), benefitId: benefitKey }),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  await expect(
    execute(
      "process.start",
      { caseId: context.caseId, benefitId: benefitKey },
      { ...context, actorId: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  expect(
    await database.db.select().from(caseSteps).where(eq(caseSteps.caseId, context.caseId)),
  ).toHaveLength(0);
});

it("FR-K5 persists answers, branches, sourced reminders and actual prepared checklists exactly once", async () => {
  // A constructed extension of a real sourced process covers immediate task reminders and artefact persistence.
  const process = definition();
  const [benefit] = await database.db.select().from(benefits).where(eq(benefits.key, benefitKey));
  if (!benefit) throw new Error("Missing loaded benefit");
  process.benefit = `ref:catalog/${benefitKey}`;
  const prepare = process.steps.find((step) => step.id === "prepare");
  if (!prepare) throw new Error("Missing test branch");
  prepare.documents = `${process.benefit}#documents`;
  prepare.reminders = [
    { after_days: 0, text_de: "Bitte prüfen Sie die vorbereiteten Unterlagen.", when: "true" },
  ];
  await database.db.insert(processes).values({
    key: process.id,
    title: process.id,
    benefitId: benefit.id,
    record: JSON.parse(JSON.stringify(process)),
  });
  // Keep the loaded process present and prove that the benefit's explicit reference selects the definition.
  await database.db
    .update(benefits)
    .set({ record: { ...benefit.record, process: `ref:processes/${process.id}` } })
    .where(eq(benefits.id, benefit.id));
  await execute("case.update", {
    caseId: context.caseId,
    patch: { confirmedGoal: "Unterlagen vorbereiten" },
  });
  const initial = contracts["process.start"].output.parse(
    await execute("process.start", { caseId: context.caseId, benefitId: benefitKey }),
  );
  expect(initial.steps).toHaveLength(1);
  const first = contracts["process.nextStep"].output.parse(
    await execute("process.nextStep", { caseId: context.caseId }),
  );
  const second = contracts["process.nextStep"].output.parse(
    await execute("process.nextStep", { caseId: context.caseId }),
  );
  expect(first.questionHint).not.toBe(second.questionHint);
  const applied = contracts["process.applyAnswers"].output.parse(
    await execute("process.applyAnswers", {
      caseId: context.caseId,
      answers: [
        { id: "accepted", value: true },
        { id: "region", value: "Wien" },
      ],
    }),
  );
  expect(applied.validationErrors).toEqual([]);
  const answerFacts = await database.db
    .select()
    .from(facts)
    .where(eq(facts.subjectId, context.subjectId));
  expect(answerFacts).toHaveLength(2);
  expect(answerFacts.every((fact) => fact.turnId !== null && fact.confirmed === false)).toBe(true);
  const step = initial.steps[0];
  if (!step) throw new Error("Missing first step");
  const completed = contracts["process.completeStep"].output.parse(
    await execute("process.completeStep", { caseId: context.caseId, stepId: step.id, evidence }),
  );
  expect(completed.reminders).toHaveLength(1);
  expect(completed.preparedArtifacts).toHaveLength(
    1 + (benefitRecordSchema.parse(benefit.record).documents.length > 0 ? 1 : 0),
  );
  const repeated = contracts["process.completeStep"].output.parse(
    await execute("process.completeStep", { caseId: context.caseId, stepId: step.id, evidence }),
  );
  expect(repeated.reminders).toEqual([]);
  expect(repeated.preparedArtifacts).toEqual([]);
  const storedSteps = await database.db
    .select()
    .from(caseSteps)
    .where(eq(caseSteps.caseId, context.caseId));
  expect(storedSteps).toHaveLength(2);
  expect(storedSteps.some((item) => item.processStep.endsWith("/contact"))).toBe(false);
  const savedReminders = await database.db
    .select()
    .from(reminders)
    .where(eq(reminders.caseId, context.caseId));
  expect(savedReminders).toHaveLength(1);
  expect(savedReminders[0]?.source.sourceQuote).toBe(process.sources[0]?.quote);
  await execute("case.update", {
    caseId: context.caseId,
    patch: { confirmedGoal: "Anderes Anliegen" },
  });
  await expect(execute("process.nextStep", { caseId: context.caseId })).rejects.toMatchObject({
    code: "GOAL_CONFIRMATION_REQUIRED",
  });
  const replanned = contracts["process.start"].output.parse(
    await execute("process.start", { caseId: context.caseId, benefitId: benefitKey }),
  );
  expect(replanned.slots).toEqual(
    expect.arrayContaining([
      { id: "accepted", value: true },
      { id: "region", value: "Wien" },
    ]),
  );
  expect(
    await database.db.select().from(facts).where(eq(facts.subjectId, context.subjectId)),
  ).toHaveLength(2);
  expect(
    await database.db.select().from(reminders).where(eq(reminders.caseId, context.caseId)),
  ).toHaveLength(0);
});

async function journeyCase(onComplete = ["process.nextStep", "reminder.create"]) {
  // Constructed process graph extends the real catalog to exercise completion side effects.
  const catalog = await database.db.select().from(benefits);
  const benefit = catalog.find((row) => benefitRecordSchema.parse(row.record).documents.length > 0);
  if (!benefit) throw new Error("Missing sourced document requirements");
  const record = benefitRecordSchema.parse(benefit.record);
  const caseId = randomUUID();
  const actorId = randomUUID();
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId: context.subjectId, confirmedGoal: "Unterlagen organisieren" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId: context.userId, role: "subject", shareScope: {} });
  const process = {
    ...definition(),
    id: `test-${randomUUID()}`,
    benefit: `ref:catalog/${benefit.key}`,
    slots: [],
    steps: [
      {
        id: "report",
        needs: [],
        on_complete: onComplete,
        reminders: [{ after_days: 1, text_de: "Nach Abschluss nachfragen" }],
        transitions: [{ to: "follow-up" }],
      },
      {
        id: "follow-up",
        needs: ["report"],
        documents: `${record.id}#documents`,
        action: "appointment.prepare",
        reminders: [{ after_days: 2, text_de: "Unterlagen bereithalten" }],
      },
    ],
  };
  await database.db
    .insert(processes)
    .values({ key: process.id, title: process.id, benefitId: benefit.id, record: process });
  await database.db
    .update(benefits)
    .set({ record: { ...benefit.record, process: `ref:processes/${process.id}` } })
    .where(eq(benefits.id, benefit.id));
  const ctx = { ...context, caseId, actorId };
  const started = contracts["process.start"].output.parse(
    await execute("process.start", { caseId, benefitId: record.id }, ctx),
  );
  const stepId = started.steps[0]?.id;
  if (!stepId) throw new Error("Missing initial step");
  return { caseId, ctx, stepId, record, process };
}

it("FR-K5 case-file completion shares the engine transaction, runs on_complete and prepares sourced next-step drafts once", async () => {
  const { caseId, stepId, record, process } = await journeyCase();
  const channel = record.appointment_channels.find((entry) => entry.kind === "phone");
  // The preparation is real deterministic administrative text; no provider or model is called.
  const drafts = callDrafts(
    { title: record.name_de, channels: channel?.kind === "phone" ? { phone: channel.number } : {} },
    [],
  );
  await database.db.insert(messages).values({
    caseId,
    position: 0,
    uiMessage: {
      id: randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "appointment.prepare",
          toolCallId: randomUUID(),
          state: "output-available",
          input: {},
          output: drafts,
        },
      ],
    },
  });
  const deadlines = createDeadlineService(database.db, context.userId);
  expect(await deadlines.list(caseId)).toEqual([]);
  const service = createCaseFileService(database.db, context.userId);
  const completion = await service.saveStep(caseId, { status: "completed" }, stepId);
  expect(completion.step.status).toBe("completed");
  const saved = await service.get(caseId);
  expect(saved.steps).toHaveLength(2);
  const next = saved.steps.find((step) => step.id !== stepId);
  expect(next).toMatchObject({
    processStep: `${process.id}/follow-up`,
    status: "pending",
    initiatedBy: "pilot",
    owner: "user",
  });
  expect(next?.linkedArtifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "call_sheet", text: drafts.callSheet }),
      expect.objectContaining({
        type: "document_request",
        text: expect.stringContaining(record.documents[0]?.name_de ?? ""),
        sources: record.documents.map((document) => document.source),
      }),
    ]),
  );
  const journey = await createWorkspaceService(database.db, context.userId).snapshot({ caseId });
  expect(journey.steps.find((step) => step.id === next?.id)).toMatchObject({
    title: "appointment.prepare",
    owner: "user",
    initiatedBy: "pilot",
    status: "prepared",
    artifacts: expect.arrayContaining([
      expect.objectContaining({ type: "call_sheet", text: drafts.callSheet }),
    ]),
  });
  const historyBeforeRetry = await service.history(caseId);
  const remindersBeforeRetry = await deadlines.list(caseId);
  expect(remindersBeforeRetry).toHaveLength(2);
  expect(
    remindersBeforeRetry.every((item) => item.source.sourceQuote === process.sources[0]?.quote),
  ).toBe(true);
  const checkpoint = await database.db.select().from(cases).where(eq(cases.id, caseId));
  expect(checkpoint[0]?.journeyMap).toMatchObject({
    process: { completed: ["report"], activated: ["report", "follow-up"] },
  });
  await Promise.all([
    service.saveStep(caseId, { status: "completed" }, stepId),
    service.saveStep(caseId, { status: "completed" }, stepId),
  ]);
  expect((await service.get(caseId)).steps).toEqual(saved.steps);
  expect(await deadlines.list(caseId)).toEqual(remindersBeforeRetry);
  expect(await service.history(caseId)).toEqual(historyBeforeRetry);
});

it("FR-K5 rejects unauthorized completion, fabricated evidence and unsupported on_complete actions without partial writes", async () => {
  const { caseId, stepId } = await journeyCase(["process.nextStep", "form.fillLive"]);
  const service = createCaseFileService(database.db, context.userId);
  await expect(
    createCaseFileService(database.db, randomUUID()).saveStep(
      caseId,
      { status: "completed" },
      stepId,
    ),
  ).rejects.toMatchObject({ code: "access_denied" });
  await expect(
    service.saveStep(caseId, { status: "completed" }, stepId, {
      type: "document_present",
      documentId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(service.saveStep(caseId, { status: "completed" }, stepId)).rejects.toMatchObject({
    code: "invalid_input",
  });
  const saved = await service.get(caseId);
  expect(saved.steps).toHaveLength(1);
  expect(saved.steps[0]?.status).toBe("pending");
  expect(saved.reminders).toHaveLength(1);
});
