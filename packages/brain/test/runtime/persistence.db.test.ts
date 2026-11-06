import { randomUUID } from "node:crypto";
import { caseActors, cases, facts, messages, profiles, reminders, turns } from "@lotse/db/schema";
import { isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import type { ToolName } from "../../src/tools/contracts/index.ts";
import { buildTools } from "../../src/tools/registry.ts";
import {
  chunks,
  config,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "./helpers.ts";

describe("WP-006 persisted authority and real tools", () => {
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
      source: { title: "Unterlagen prüfen", quote: "User statement" },
    });
    await expect(
      execute("case.update", { caseId: randomUUID(), patch: { status: "completed" } }, context),
    ).rejects.toThrow("Case access denied");
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
  it.each([
    { allowStubs: true, state: "output-available" },
    { allowStubs: false, state: "output-error" },
  ])(
    "NFR-4 persists an approved server tool's $state before model continuation",
    async ({ allowStubs, state }) => {
      const { session, context } = await start();
      // The server approval tool is a W0 stub. Exercise its existing explicit
      // build-fixture branch for success and its release error branch for failure.
      const runtimeConfig = { ...config, allowStubs };
      await chunks(
        await handleTurn({ ...turn, caseId: context.caseId }, userMessage(), session, {
          db: database.db,
          config: runtimeConfig,
          model: forcedModel("form.commitGroup", {
            formInstanceId: randomUUID(),
            fieldIds: ["reviewed-field"],
            values: { "reviewed-field": "User statement" },
          }),
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
