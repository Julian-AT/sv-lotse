import { createHash, randomUUID } from "node:crypto";
import {
  caseActors,
  cases,
  facts,
  formInstances,
  formTemplates,
  messages,
  profiles,
  reminders,
  turns,
} from "@lotse/db/schema";
import { JsonObjectSchema, SpeechSegmentSchema } from "@lotse/protocol";
import { isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import { detectFields } from "../../src/forms/detect/index.ts";
import type { ToolName } from "../../src/tools/contracts/index.ts";
import { buildTools } from "../../src/tools/registry.ts";
import { formNames, readForm } from "../forms/detect/fixtures.ts";
import {
  chunks,
  config,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "./helpers.ts";

// Real Postgres authority tests use isolated classifier/guard doubles; live pipeline tests call providers.
vi.mock("../../src/pipeline/classify.ts", () => ({
  classifyInput: async () => ({
    language: "de-AT",
    intent: "administrative",
    lifeSituation: null,
    candidateGoal: null,
    confirmsPendingGoal: false,
    factTypes: [],
  }),
}));
vi.mock("../../src/pipeline/guards.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/pipeline/guards.ts")>()),
  guardAnswer: async (_config: unknown, text: string) => text,
}));

describe("persisted authority and real tools", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  beforeAll(async () => {
    database = await isolatedDatabase();
  });
  afterAll(async () => {
    if (database) await database.cleanup();
  });
  async function start() {
    const session = await identity(database.db);
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    await database.db
      .update(cases)
      .set({ confirmedGoal: "Prepare administrative documents" })
      .where(eq(cases.id, context.caseId));
    return { session, context };
  }
  async function execute(name: ToolName, input: unknown, context: RuntimeContext) {
    const tool = buildTools({ db: database.db, allowStubs: false })[name];
    if (!tool.execute) throw new Error("Missing server tool");
    return tool.execute(input, { context, toolCallId: randomUUID(), messages: [] });
  }
  it("FR-A1 creates the self case, resolves its owner's profile and defaults to L1", async () => {
    const { session, context } = await start();
    expect(context.autonomyLevel).toBe("L2");
    await database.db.delete(profiles).where(eq(profiles.userId, session.userId));
    const withoutProfile = await database.db.transaction((tx) =>
      resolveContext(tx, { ...turn, caseId: context.caseId }, session),
    );
    expect(withoutProfile.autonomyLevel).toBe("L1");
    const another = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    expect(another.subjectId).toBe(context.subjectId);
    expect(another.caseId).not.toBe(context.caseId);
  });
  it("FR-P7 refuses a foreign case and a mismatched subject", async () => {
    const { session, context } = await start();
    const foreign = await identity(database.db);
    await expect(
      handleTurn({ ...turn, caseId: context.caseId }, userMessage(), foreign, {
        db: database.db,
        config,
        model: forcedModel(),
      }),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
    await expect(
      handleTurn(
        { ...turn, caseId: context.caseId, subjectId: randomUUID() },
        userMessage(),
        session,
        { db: database.db, config, model: forcedModel() },
      ),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
  });
  it("FR-P1 queries real subject facts within the helper's stored share scope", async () => {
    const { context } = await start();
    const sourceTurn = randomUUID();
    await database.db.insert(turns).values({ id: sourceTurn, caseId: context.caseId });
    await database.db.insert(facts).values(
      ["residence.region", "insurance.carrier"].map((type) => ({
        subjectId: context.subjectId,
        type,
        value: "User statement",
        turnId: sourceTurn,
        source: { kind: "statement", turnId: sourceTurn },
        confidence: 1,
        confirmed: true,
      })),
    );
    const helper = await identity(database.db, "L3");
    await database.db.insert(caseActors).values({
      caseId: context.caseId,
      userId: helper.userId,
      role: "helper",
      shareScope: { case: true, facts: ["residence.region"] },
    });
    const helperContext = await database.db.transaction((tx) =>
      resolveContext(tx, { ...turn, caseId: context.caseId }, helper),
    );
    expect(helperContext.autonomyLevel).toBe("L2");
    const input = {
      subjectId: context.subjectId,
      factTypes: ["residence.region", "insurance.carrier"],
    };
    expect(await execute("context.queryFacts", input, context)).toHaveLength(2);
    expect(await execute("context.queryFacts", input, helperContext)).toEqual([
      expect.objectContaining({ type: "residence.region" }),
    ]);
    await expect(
      execute("context.queryFacts", { ...input, subjectId: randomUUID() }, context),
    ).rejects.toThrow("Subject access denied");
  });
  it("FR-P7 denies restricted helper history containing an owner's unshared fact", async () => {
    const { session, context } = await start();
    const sourceTurn = randomUUID();
    await database.db
      .insert(turns)
      .values({ id: sourceTurn, caseId: context.caseId, status: "completed" });
    await database.db.insert(facts).values({
      subjectId: context.subjectId,
      type: "insurance.carrier",
      value: "Private owner value",
      turnId: sourceTurn,
      source: { kind: "statement", turnId: sourceTurn },
      confidence: 1,
      confirmed: true,
    });
    await chunks(
      await handleTurn({ ...turn, caseId: context.caseId }, userMessage(), session, {
        db: database.db,
        config,
        model: forcedModel("context.queryFacts", {
          subjectId: context.subjectId,
          factTypes: ["insurance.carrier"],
        }),
      }),
    );
    const ownerHistory = await database.db
      .select()
      .from(messages)
      .where(eq(messages.caseId, context.caseId));
    expect(JSON.stringify(ownerHistory)).toContain("Private owner value");
    const helper = await identity(database.db);
    await database.db.insert(caseActors).values({
      caseId: context.caseId,
      userId: helper.userId,
      role: "helper",
      shareScope: { case: true, facts: ["residence.region"] },
    });
    const model = forcedModel();
    await expect(
      handleTurn({ ...turn, caseId: context.caseId }, userMessage(), helper, {
        db: database.db,
        config,
        model,
      }),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(
      await database.db.select().from(messages).where(eq(messages.caseId, context.caseId)),
    ).toEqual(ownerHistory);
  });
  it("writes case changes and sourced reminders to Postgres and refuses cross-case writes", async () => {
    const { context } = await start();
    await execute(
      "case.update",
      {
        caseId: context.caseId,
        patch: { confirmedGoal: "Verwaltungsunterlagen ordnen", status: "paused" },
      },
      context,
    );
    const [updated] = await database.db.select().from(cases).where(eq(cases.id, context.caseId));
    expect(updated).toMatchObject({
      confirmedGoal: "Verwaltungsunterlagen ordnen",
      status: "paused",
    });
    const dueAt = "2026-12-01T12:00:00Z";
    await execute(
      "reminder.create",
      { caseId: context.caseId, dueAt, title: "Unterlagen prüfen", sourceQuote: "User statement" },
      context,
    );
    const [reminder] = await database.db
      .select()
      .from(reminders)
      .where(eq(reminders.caseId, context.caseId));
    expect(reminder).toMatchObject({
      dueAt: new Date(dueAt),
      source: { kind: "manual", title: "Unterlagen prüfen", sourceQuote: "User statement" },
    });
    await expect(
      execute("case.update", { caseId: randomUUID(), patch: { status: "completed" } }, context),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it("preserves communication preferences, telemetry and guarded speech across context refreshes", async () => {
    const { session, context } = await start();
    const model = forcedModel("context.queryFacts", {
      subjectId: context.subjectId,
      factTypes: [],
    });
    const languageModel = forcedModel();
    const generate = languageModel.doGenerate;
    languageModel.doGenerate = async (options) => ({
      ...(await generate(options)),
      content: [
        {
          type: "text",
          text: JSON.stringify({
            detectedLanguage: "en",
            requestedLanguage: "en",
            simpleLanguage: true,
            register: "informal",
            detailLevel: "brief",
          }),
        },
      ],
    });

    const output = await chunks(
      await handleTurn({ ...turn, caseId: context.caseId }, userMessage(), session, {
        db: database.db,
        config,
        model,
        languageModel,
      }),
    );

    expect(output.some((part) => part.type === "error")).toBe(false);
    expect(model.doStreamCalls).toHaveLength(2);
    for (const call of model.doStreamCalls) {
      const prompt = JSON.stringify(call.prompt);
      expect(prompt).toContain("untrusted context data");
      expect(prompt).toContain("Reply language: English");
      expect(prompt).toContain("CEFR A2");
      expect(prompt).toContain("Address the user informally");
      expect(prompt).toContain("Keep answers brief");
    }
    const speech = output.flatMap((part) =>
      part.type === "data-speech-segment" ? [SpeechSegmentSchema.parse(part.data)] : [],
    );
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.map((segment) => segment.language)).toEqual(speech.map(() => "en"));
    expect(speech.map((segment) => segment.index)).toEqual(speech.map((_, index) => index));
    const [stored] = await database.db.select().from(turns).where(eq(turns.caseId, context.caseId));
    expect(stored?.segments).toEqual(speech);
    expect(stored?.timings).toMatchObject({ modelCalls: 2, toolCount: 1 });
    expect(stored?.timings.classificationMs).toBeTypeOf("number");
    expect(stored?.timings.guardMs).toBeTypeOf("number");
    expect(stored?.timings.firstSegmentMs).toBeTypeOf("number");
    expect(stored?.modelIds).toEqual({ used: [model.modelId] });
    const [profile] = await database.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, session.userId));
    expect(profile?.language).toBe("en-simple");
  });
  it("NFR-4 persists a completed tool step before the next model call", async () => {
    const { session, context } = await start();
    const model = forcedModel("case.update", {
      caseId: context.caseId,
      patch: { confirmedGoal: "Verwaltungsunterlagen ordnen" },
    });
    const stream = model.doStream;
    let calls = 0;
    let observedPersistedStep = false;
    model.doStream = async (options) => {
      calls++;
      if (calls === 2) {
        const rows = await database.db
          .select()
          .from(messages)
          .where(eq(messages.caseId, context.caseId))
          .orderBy(messages.position);
        observedPersistedStep =
          rows
            .at(-1)
            ?.uiMessage.parts.some(
              (part) => isToolUIPart(part) && part.state === "output-available",
            ) ?? false;
      }
      return stream(options);
    };
    await chunks(
      await handleTurn({ ...turn, caseId: context.caseId }, userMessage(), session, {
        db: database.db,
        config,
        model,
      }),
    );
    expect(calls).toBe(2);
    expect(observedPersistedStep).toBe(true);
  });
  async function reviewedForm(context: RuntimeContext) {
    for (const name of await formNames()) {
      const bytes = await readForm(name);
      const detected = await detectFields(bytes, { mode: "acroform", vision: "disabled" });
      const field = detected.fields.find(
        (candidate) =>
          candidate.type === "text" &&
          candidate.owner === "applicant" &&
          candidate.signature === "none" &&
          !detected.fields.some(
            (other) =>
              other.acro_field === candidate.acro_field &&
              (other.owner !== "applicant" || other.signature !== "none"),
          ),
      );
      if (!field) continue;
      const templateId = randomUUID();
      const formInstanceId = randomUUID();
      await database.db.insert(formTemplates).values({
        id: templateId,
        publisher: "SV-Box",
        title: name,
        source: `data/svbox/Anträge und Formulare/${name}`,
        hash: createHash("sha256").update(bytes).digest("hex"),
        format: "acroform",
        pages: detected.pages.length,
        storageKey: "unused-original",
        schema: JsonObjectSchema.parse({
          fields: [{ ...field, page: field.box.page, validation: {} }],
        }),
      });
      await database.db.insert(formInstances).values({
        id: formInstanceId,
        templateId,
        subjectId: context.subjectId,
        caseId: context.caseId,
        fields: {},
      });
      return { formInstanceId, fieldIds: [field.id], values: { [field.id]: "User statement" } };
    }
    throw new Error("No writable original form field found");
  }
  it.each([
    { instancePresent: true, state: "output-available" },
    { instancePresent: false, state: "output-error" },
  ])(
    "NFR-4 persists an approved server tool's $state before model continuation",
    async ({ instancePresent, state }) => {
      const { session, context } = await start();
      // A real SV-Box field supports the success case; a missing instance proves failure.
      const input = instancePresent
        ? await reviewedForm(context)
        : {
            formInstanceId: randomUUID(),
            fieldIds: ["reviewed-field"],
            values: { "reviewed-field": "User statement" },
          };
      const runtimeConfig = config;
      await chunks(
        await handleTurn({ ...turn, caseId: context.caseId }, userMessage(), session, {
          db: database.db,
          config: runtimeConfig,
          model: forcedModel("form.commitGroup", input),
        }),
      );
      const rows = await database.db
        .select()
        .from(messages)
        .where(eq(messages.caseId, context.caseId))
        .orderBy(messages.position);
      const approved = structuredClone(rows.at(-1)?.uiMessage);
      if (!approved) throw new Error("Missing approval message");
      approved.parts = approved.parts.map((part) =>
        isToolUIPart(part) && part.state === "approval-requested"
          ? {
              ...part,
              state: "approval-responded" as const,
              approval: { ...part.approval, approved: true },
            }
          : part,
      );
      const model = forcedModel();
      const stream = model.doStream;
      let persistedState: string | undefined;
      model.doStream = async (options) => {
        const persisted = await database.db
          .select()
          .from(messages)
          .where(eq(messages.caseId, context.caseId))
          .orderBy(messages.position);
        const part = persisted.at(-1)?.uiMessage.parts.find(isToolUIPart);
        persistedState = part?.state;
        return stream(options);
      };
      const result = await chunks(
        await handleTurn({ ...turn, caseId: context.caseId }, approved, session, {
          db: database.db,
          config: runtimeConfig,
          model,
        }),
      );
      expect(result.some((part) => part.type === "text-delta")).toBe(true);
      expect(persistedState).toBe(state);
    },
  );
  it("NFR-4 rejects a delayed writer after an expired turn is replaced", async () => {
    const { session, context } = await start();
    let release = () => {};
    let entered = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const oldModel = forcedModel();
    const stream = oldModel.doStream;
    oldModel.doStream = async (options) => {
      entered();
      await paused;
      return stream(options);
    };
    const oldResponse = await handleTurn(
      { ...turn, caseId: context.caseId },
      userMessage(),
      session,
      { db: database.db, config, model: oldModel },
    );
    const oldDrain = chunks(oldResponse).then(
      () => undefined,
      (error: unknown) => error,
    );
    await started;
    try {
      const [oldTurn] = await database.db
        .select()
        .from(turns)
        .where(eq(turns.caseId, context.caseId));
      if (!oldTurn) throw new Error("Missing running turn");
      await database.db
        .update(turns)
        .set({ createdAt: new Date(Date.now() - 6 * 60_000) })
        .where(eq(turns.id, oldTurn.id));
      await chunks(
        await handleTurn({ ...turn, caseId: context.caseId }, userMessage(), session, {
          db: database.db,
          config,
          model: forcedModel(),
        }),
      );
      const replacementHistory = await database.db
        .select()
        .from(messages)
        .where(eq(messages.caseId, context.caseId))
        .orderBy(messages.position);
      release();
      expect(await oldDrain).toMatchObject({ code: "TURN_SUPERSEDED" });
      expect(
        await database.db
          .select()
          .from(messages)
          .where(eq(messages.caseId, context.caseId))
          .orderBy(messages.position),
      ).toEqual(replacementHistory);
      expect(
        (await database.db.select().from(turns).where(eq(turns.id, oldTurn.id)))[0]?.status,
      ).toBe("interrupted");
    } finally {
      release();
      await oldDrain;
    }
  });
});
