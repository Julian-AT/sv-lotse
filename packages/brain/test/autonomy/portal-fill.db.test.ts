import { randomUUID } from "node:crypto";
import { approvals, benefits } from "@lotse/db/schema";
import { isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../../src/approvals/index.ts";
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

// Addresses on a real allowlisted origin, used only to exercise the policy. They do not claim
// that a specific application form, login page or booking page exists at these addresses.
const portal = "https://www.oegk.at";
const fillOn = (url: string) => ({
  ...fillInput,
  target: { kind: "dom", handle: "applicant-name", url },
});
const portalFill = fillOn(`${portal}/antraege/formular?step=2`);

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
  createResponseGuard: () => async (input: { text: string }) => ({
    text: input.text,
    disposition: "allow",
    reason: "allowed",
  }),
}));

describe("FR-D7 server-side approval of guided portal fills", () => {
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

  async function proposeFill(input: unknown, level: "L2" | "L3" = "L2") {
    const session = await identity(database.db, level);
    const model = forcedModel("ui.fill", input);
    const response = await handleTurn(
      await confirmedRequest(database.db, session),
      userMessage(),
      session,
      { db: database.db, config, model },
    );
    const caseId = response.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Case id missing");
    const stream = await chunks(response);
    expect(model.doStreamCalls.length).toBeGreaterThan(0);
    const rows = await database.db.select().from(approvals).where(eq(approvals.caseId, caseId));
    return { session, model, caseId, stream, rows };
  }

  /** The server denies the call itself: no approval prompt, no row and nothing sent to type. */
  function expectRefused(flow: Awaited<ReturnType<typeof proposeFill>>, label: string): void {
    expect(flow.stream, label).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "error", errorText: "TURN_FAILED_AUTHORITY" }),
      ]),
    );
    expect(
      flow.stream.some((part) => part.type === "tool-approval-request"),
      label,
    ).toBe(false);
    expect(
      flow.stream.some((part) => part.type === "tool-input-available"),
      label,
    ).toBe(false);
    expect(flow.rows, label).toEqual([]);
  }

  async function requestDirectly(input: unknown, level: "L2" | "L3" = "L2") {
    const session = await identity(database.db, level);
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    const call = { approvalId: randomUUID(), toolCallId: randomUUID(), toolName: "ui.fill", input };
    const service = createApprovalService(database.db, config.approvalSecret);
    return { context, call, service, request: () => service.request(call, context) };
  }

  it("types on an allowlisted portal at L2 only after the subject's server-verified approval", async () => {
    const flow = await proposeFill(portalFill);
    expect(flow.stream.some((part) => part.type === "error")).toBe(false);
    expect(flow.stream.some((part) => part.type === "tool-approval-request")).toBe(true);
    expect(flow.rows).toHaveLength(1);
    expect(flow.rows[0]).toMatchObject({
      toolName: "ui.fill",
      decision: "pending",
      consumedAt: null,
    });

    const message = (await loadMessages(database.db, flow.caseId)).at(-1);
    if (!message) throw new Error("Message missing");
    const approved: LotseMessage = {
      ...message,
      parts: message.parts.map((part) =>
        isToolUIPart(part) && part.state === "approval-requested"
          ? {
              ...part,
              state: "approval-responded" as const,
              approval: { ...part.approval, approved: true },
            }
          : part,
      ),
    };
    const dispatched = await chunks(
      await handleTurn({ ...turn, caseId: flow.caseId }, approved, flow.session, {
        db: database.db,
        config,
        model: flow.model,
      }),
    );
    const typed = dispatched.find((part) => part.type === "tool-input-available");
    expect(typed).toMatchObject({ toolName: "ui.fill", input: portalFill });
    const [row] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, flow.caseId));
    expect(row?.decision).toBe("approved");
    expect(row?.consumedAt).not.toBeNull();
  });

  it("refuses a portal outside the knowledge portal policy before any approval exists", async () => {
    const outside = fillOn("https://portal.example.org/antraege/formular");
    expectRefused(await proposeFill(outside), "outside origin");
    const direct = await requestDirectly(outside);
    await expect(direct.request()).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
  });

  it("refuses login pages on allowlisted origins at L2 and L3", async () => {
    const logins = ["/login", "/auth/realms/sv/protocol/openid-connect/auth"].map((path) =>
      fillOn(`${portal}${path}`),
    );
    for (const [index, level] of (["L2", "L3"] as const).entries()) {
      expectRefused(await proposeFill(logins[index], level), level);
      for (const login of logins) {
        const direct = await requestDirectly(login, level);
        await expect(direct.request()).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
      }
    }
  });

  it("never dispatches a click or submit: the approved continuation only types the bound value", async () => {
    const flow = await proposeFill(portalFill, "L3");
    const offered = flow.model.doStreamCalls[0]?.tools?.map((tool) => tool.name) ?? [];
    expect(offered).toContain("ui.fill");
    expect(
      offered.filter((name) => /click|submit|send|pay|book|confirm|press/iu.test(name)),
    ).toEqual([]);
    // A changed input (for example a different handle such as a submit control) needs a new approval.
    const direct = await requestDirectly(portalFill, "L3");
    await direct.request();
    const changed = { ...direct.call, input: fillOn(`${portal}/antraege/formular?step=3`) };
    await expect(
      database.db.transaction((tx) => direct.service.decide(tx, changed, direct.context, true)),
    ).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
  });

  it("rechecks booking review at decision time so a new booking page stays L3 only", async () => {
    // Test-only review fixture: not a claim that this address is a real booking page.
    const bookingUrl = `${portal}/termine/online?region=wien`;
    const variant = fillOn(`${bookingUrl}&slot=1`);
    const direct = await requestDirectly(variant);
    await direct.request();
    const [benefit] = await database.db
      .insert(benefits)
      .values({
        key: randomUUID(),
        title: "Policy fixture",
        category: "F",
        record: {
          sources: [{ url: portal, quote: "ÖGK", retrieved_at: "2026-11-06T10:00:00Z" }],
          appointment_channels: [{ kind: "online", url: bookingUrl, verified_at: "2026-11-06" }],
        },
      })
      .returning();
    if (!benefit) throw new Error("Fixture insert failed");
    try {
      await expect(
        database.db.transaction((tx) =>
          direct.service.decide(tx, direct.call, direct.context, true),
        ),
      ).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
      const exact = await requestDirectly(fillOn(bookingUrl));
      await expect(exact.request()).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
    } finally {
      await database.db.delete(benefits).where(eq(benefits.id, benefit.id));
    }
  });
});
