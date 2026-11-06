import { randomUUID } from "node:crypto";
import { approvals, benefits, caseActors, profiles } from "@lotse/db/schema";
import { isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../../src/approvals/index.ts";
import { fillIsAllowed } from "../../src/autonomy/booking.ts";
import {
  autonomyFillPages,
  bookingGuideConfiguration,
  createAutonomyService,
} from "../../src/autonomy/index.ts";
import { loadMessages } from "../../src/conversation/history.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import type { LotseMessage } from "../../src/tools/types.ts";
import {
  chunks,
  config,
  confirmedRequest,
  fillInput,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "../runtime/helpers.ts";

// Authority tests exercise real Postgres and simulated SDK turns without provider calls.
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
vi.mock("../../src/retrieval/index.ts", async (original) => ({
  ...(await original<typeof import("../../src/retrieval/index.ts")>()),
  searchKnowledge: async () => [],
}));
vi.mock("../../src/pipeline/guards.ts", async (original) => ({
  ...(await original<typeof import("../../src/pipeline/guards.ts")>()),
  guardAnswer: async (_config: unknown, text: string) => text,
}));
vi.mock("../../src/guards/index.ts", async (original) => ({
  ...(await original<typeof import("../../src/guards/index.ts")>()),
  createResponseGuard: () =>
    Object.assign(
      async (input: { text: string }) => ({
        text: input.text,
        disposition: "allow",
        reason: "allowed",
      }),
      { prewarm: () => {} },
    ),
}));

describe("FR-A1 persisted settings and FR-O6 authorization", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  beforeAll(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("UNEXPECTED_PROVIDER_REQUEST");
      }),
    );
    database = await isolatedDatabase();
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    if (database) await database.cleanup();
    vi.unstubAllGlobals();
  });

  async function pendingFill() {
    const session = await identity(database.db, "L3");
    const model = forcedModel("ui.fill");
    const response = await handleTurn(
      await confirmedRequest(database.db, session),
      userMessage(),
      session,
      {
        db: database.db,
        config,
        model,
      },
    );
    const caseId = response.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Case id missing");
    await chunks(response);
    const read = async (): Promise<LotseMessage> => {
      const message = (await loadMessages(database.db, caseId)).at(-1);
      if (!message) throw new Error("Message missing");
      return message;
    };
    const send = async (message: LotseMessage) =>
      chunks(
        await handleTurn({ ...turn, caseId }, message, session, { db: database.db, config, model }),
      );
    const reply = async (approved: boolean): Promise<LotseMessage> => {
      const message = await read();
      return {
        ...message,
        parts: message.parts.map((part) =>
          isToolUIPart(part) && part.state === "approval-requested"
            ? {
                ...part,
                state: "approval-responded" as const,
                approval: { ...part.approval, approved },
              }
            : part,
        ),
      };
    };
    return { session, model, read, send, reply, caseId };
  }

  it("lets the subject dismiss a pending approval after lowering the stored level", async () => {
    const flow = await pendingFill();
    await createAutonomyService(database.db, flow.session.userId).change({
      autonomyLevel: "L1",
      confirmed: true,
    });
    const stream = await flow.send(await flow.reply(false));
    expect(stream.some((part) => part.type === "tool-input-available")).toBe(false);
    const [row] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, flow.caseId));
    expect(row).toMatchObject({ decision: "denied", consumedAt: null });
    expect(stream.some((part) => part.type === "text-delta")).toBe(true);
  });

  it("records an already-dispatched result after a downgrade without dispatching it again", async () => {
    const flow = await pendingFill();
    const dispatched = await flow.send(await flow.reply(true));
    expect(dispatched.some((part) => part.type === "tool-input-available")).toBe(true);
    const message = await flow.read();
    const result: LotseMessage = {
      ...message,
      parts: message.parts.map((part) =>
        isToolUIPart(part) && part.state === "approval-responded" && part.approval.approved
          ? {
              ...part,
              state: "output-available" as const,
              approval: { ...part.approval, approved: true as const },
              output: { actionId: randomUUID(), resolvedBy: "ui", confidence: 1, success: true },
            }
          : part,
      ),
    };
    await createAutonomyService(database.db, flow.session.userId).change({
      autonomyLevel: "L1",
      confirmed: true,
    });
    const stream = await flow.send(result);
    expect(stream.some((part) => part.type === "tool-input-available")).toBe(false);
    expect(stream.some((part) => part.type === "text-delta")).toBe(true);
    expect(flow.model.doStreamCalls.at(-1)?.tools?.map((tool) => tool.name)).not.toContain(
      "ui.fill",
    );
  });

  it("refreshes prepareStep permissions from the stored level between model steps", async () => {
    const session = await identity(database.db, "L3");
    const model = forcedModel("ui.caption", {
      target: { kind: "ui", elementId: "caption" },
      label: "Verwaltungsunterlagen",
    });
    const original = model.doStream.bind(model);
    let calls = 0;
    model.doStream = async (options) => {
      if (calls++ === 0)
        await createAutonomyService(database.db, session.userId).change({
          autonomyLevel: "L1",
          confirmed: true,
        });
      return original(options);
    };
    await chunks(
      await handleTurn(await confirmedRequest(database.db, session), userMessage(), session, {
        db: database.db,
        config,
        model,
      }),
    );
    expect(model.doStreamCalls[0]?.tools?.map((tool) => tool.name)).toContain("ui.fill");
    expect(model.doStreamCalls[1]?.tools?.map((tool) => tool.name)).not.toContain("ui.fill");
    expect(model.doStreamCalls[1]?.tools?.map((tool) => tool.name)).not.toContain("form.fillLive");
  });

  it("never lets a helper's settings enable the subject's booking capability", async () => {
    const owner = await identity(database.db, "L1");
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, owner));
    const helper = await identity(database.db, "L1");
    await database.db.insert(caseActors).values({
      caseId: context.caseId,
      userId: helper.userId,
      role: "helper",
      shareScope: { case: true, facts: true },
    });
    await createAutonomyService(database.db, helper.userId).change({
      autonomyLevel: "L3",
      confirmed: true,
    });
    const policy = await bookingGuideConfiguration(database.db, context.caseId, helper);
    expect(policy).toMatchObject({ autonomyLevel: "L1", bookingPages: [], ghostPreview: true });
    expect(await createAutonomyService(database.db, owner.userId).read()).toEqual({
      autonomyLevel: "L1",
    });
    const stranger = await identity(database.db, "L3");
    await expect(
      bookingGuideConfiguration(database.db, context.caseId, stranger),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
  });

  it("defaults to L1, persists confirmed settings, and uses them in the next server context", async () => {
    const session = await identity(database.db);
    await database.db.delete(profiles).where(eq(profiles.userId, session.userId));
    const service = createAutonomyService(database.db, session.userId);
    expect(await service.read()).toEqual({ autonomyLevel: "L1" });
    await expect(service.change({ autonomyLevel: "L3" })).rejects.toMatchObject({
      code: "INVALID_AUTONOMY",
    });
    await service.change({ autonomyLevel: "L3", confirmed: true });
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    expect(context.autonomyLevel).toBe("L3");
    await service.change({ autonomyLevel: "L1", confirmed: true });
    expect(
      (
        await database.db.transaction((tx) =>
          resolveContext(tx, { ...turn, caseId: context.caseId }, session),
        )
      ).autonomyLevel,
    ).toBe("L1");
  });

  it("rejects an old approval after a stored downgrade", async () => {
    const session = await identity(database.db, "L3");
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    const service = createApprovalService(database.db, config.approvalSecret);
    const call = {
      approvalId: randomUUID(),
      toolCallId: randomUUID(),
      toolName: "ui.fill",
      input: fillInput,
    };
    await service.request(call, context);
    await createAutonomyService(database.db, session.userId).change({
      autonomyLevel: "L1",
      confirmed: true,
    });
    await expect(
      database.db.transaction(async (tx) => {
        const current = await resolveContext(tx, { ...turn, caseId: context.caseId }, session);
        await service.decide(tx, call, current, true);
      }),
    ).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
    const [row] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.approvalId, call.approvalId));
    expect(row).toMatchObject({ decision: "pending", consumedAt: null });
  });

  it("binds booking approval to the exact reviewed URL and rechecks L3 before dispatch", async () => {
    const session = await identity(database.db, "L3");
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    // Test-only review fixture based on an actual allowlisted publisher. This is not a claim
    // that the publisher's home page is a real booking page, and never enters product data.
    const url = "https://www.oegk.at/";
    const record = {
      sources: [{ url, quote: "ÖGK", retrieved_at: "2026-11-06T10:00:00Z" }],
      appointment_channels: [{ kind: "online", url, verified_at: "2026-11-06" }],
    };
    const [benefit] = await database.db
      .insert(benefits)
      .values({ key: randomUUID(), title: "Policy fixture", category: "F", record })
      .returning();
    if (!benefit) throw new Error("Fixture insert failed");
    const input = { ...fillInput, target: { kind: "dom", handle: "field", url } };
    expect(await fillIsAllowed(database.db, input, context)).toBe(true);
    expect(await autonomyFillPages(database.db, session.userId)).toContain(url);
    expect(
      await fillIsAllowed(
        database.db,
        { ...input, target: { ...input.target, url: `${url}#other` } },
        context,
      ),
    ).toBe(false);
    expect(
      await fillIsAllowed(
        database.db,
        { ...input, target: { ...input.target, url: `${url}?other=1` } },
        context,
      ),
    ).toBe(false);
    expect(await fillIsAllowed(database.db, input, { ...context, autonomyLevel: "L2" })).toBe(
      false,
    );
    const service = createApprovalService(database.db, config.approvalSecret);
    const call = { approvalId: randomUUID(), toolCallId: randomUUID(), toolName: "ui.fill", input };
    await service.request(call, context);
    // Booking pages stay L3 only: a stored downgrade to L2 invalidates the pending booking approval.
    // (Without its review, the address would be an ordinary allowlisted portal page; see FR-D7.)
    const autonomy = createAutonomyService(database.db, session.userId);
    await autonomy.change({ autonomyLevel: "L2", confirmed: true });
    try {
      await expect(
        database.db.transaction(async (tx) => {
          const current = await resolveContext(tx, { ...turn, caseId: context.caseId }, session);
          await service.decide(tx, call, current, true);
        }),
      ).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
    } finally {
      await database.db.delete(benefits).where(eq(benefits.id, benefit.id));
    }
    await autonomy.change({ autonomyLevel: "L3", confirmed: true });
    expect(await autonomyFillPages(database.db, session.userId)).not.toContain(url);
  });
});
