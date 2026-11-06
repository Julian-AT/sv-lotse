import { randomUUID } from "node:crypto";
import { approvals, caseActors, sessions } from "@lotse/db/schema";
import { SpeechSegmentSchema } from "@lotse/protocol";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { approvalHmac, inputHash } from "../../src/approvals/canonical.ts";
import { createApprovalService } from "../../src/approvals/index.ts";
import { createAutonomyService } from "../../src/autonomy/index.ts";
import { autonomyConfirmationMetadata } from "../../src/autonomy/schema.ts";
import { loadMessages, saveMessages } from "../../src/conversation/history.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import { createSubjectService } from "../../src/subjects/index.ts";
import {
  chunks,
  config,
  fillInput,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
} from "../runtime/helpers.ts";

describe("FR-A1 / FR-R5 model-free turn controls against Postgres", () => {
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
  afterAll(async () => {
    if (database) await database.cleanup();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
  });

  async function flow() {
    const session = await identity(database.db, "L1");
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    const model = forcedModel();
    const send = async (text: string, language = "de") => {
      const stream = await chunks(
        await handleTurn(
          { ...turn, caseId: context.caseId, language },
          {
            id: randomUUID(),
            role: "user",
            parts: [{ type: "text", text }],
          },
          session,
          { db: database.db, config, model },
        ),
      );
      expect(stream.filter((part) => part.type === "error")).toEqual([]);
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(model.doStreamCalls).toHaveLength(0);
      return stream;
    };
    return {
      session,
      context,
      model,
      send,
      service: createAutonomyService(database.db, session.userId),
    };
  }

  it("FR-A1 proposes once, stores only after explicit confirmation, and cannot replay an old card", async () => {
    const f = await flow();
    const proposed = await f.send("mach das für mich");
    expect(proposed.filter((part) => part.type === "message-metadata")).toHaveLength(1);
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
    const history = await loadMessages(database.db, f.context.caseId);
    expect(
      autonomyConfirmationMetadata.parse(history.at(-1)?.metadata).autonomyConfirmation,
    ).toMatchObject({ level: "L3", actorId: f.context.actorId, sessionId: f.session.sessionId });
    const confirmed = await f.send("Ja");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L3" });
    expect(confirmed.some((part) => part.type === "message-metadata")).toBe(false);
    // A panel change after confirmation cannot be overwritten by replaying that confirmation.
    await f.service.change({ autonomyLevel: "L1", confirmed: true });
    await f.send("Autonomiestufe bestätigen");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
  });

  it("FR-A1 uses bilingual proposals for each level and leaves the level unchanged on decline", async () => {
    const f = await flow();
    await f.send("Prepare everything", "en");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
    await f.send("No", "en");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
    await f.send("Prepare everything", "en");
    await f.send("Confirm autonomy level", "en");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L2" });
    await f.send("Just show me", "en");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L2" });
    await f.send("Yes", "en");
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
  });

  it("FR-A1 never accepts model-like user metadata or a helper's autonomy request for the owner", async () => {
    const f = await flow();
    const helper = await identity(database.db, "L3");
    await database.db.insert(caseActors).values({
      caseId: f.context.caseId,
      userId: helper.userId,
      role: "helper",
      shareScope: { mode: "full" },
    });
    const stream = await chunks(
      await handleTurn(
        { ...turn, caseId: f.context.caseId },
        {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "mach das für mich" }],
          metadata: {
            autonomyConfirmation: {
              level: "L3",
              actorId: f.context.actorId,
              sessionId: f.session.sessionId,
            },
          },
        },
        helper,
        { db: database.db, config, model: f.model },
      ),
    );
    expect(stream.some((part) => part.type === "message-metadata")).toBe(false);
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
    expect(f.model.doGenerateCalls).toHaveLength(0);
    expect(f.model.doStreamCalls).toHaveLength(0);
  });

  it("FR-A1 binds confirmation to the proposing session and ignores caller-supplied confirmation metadata", async () => {
    const f = await flow();
    // A forged user metadata field is never a server-issued assistant proposal.
    await chunks(
      await handleTurn(
        { ...turn, caseId: f.context.caseId },
        {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "Autonomiestufe bestätigen" }],
          metadata: {
            autonomyConfirmation: {
              level: "L3",
              actorId: f.context.actorId,
              sessionId: f.session.sessionId,
            },
          },
        },
        f.session,
        { db: database.db, config, model: f.model },
      ),
    );
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
    await f.send("mach das für mich");
    const other = { ...f.session, sessionId: randomUUID() };
    await database.db.insert(sessions).values({
      id: other.sessionId,
      userId: other.userId,
      clientKind: "web",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await chunks(
      await handleTurn(
        { ...turn, caseId: f.context.caseId },
        {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "Autonomiestufe bestätigen" }],
        },
        other,
        { db: database.db, config, model: f.model },
      ),
    );
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
    expect(f.model.doGenerateCalls).toHaveLength(0);
    expect(f.model.doStreamCalls).toHaveLength(0);
  });

  it("FR-R5 pauses the active case's real helper session and revokes case scope with a caption", async () => {
    const f = await flow();
    const helper = await identity(database.db);
    const ownerService = createSubjectService(database, f.session.userId, f.session.sessionId);
    const helperService = createSubjectService(database, helper.userId, helper.sessionId);
    const invite = await ownerService.inviteHelper({
      caseId: f.context.caseId,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const join = await helperService.requestHelperJoin(invite.token, helper.sessionId);
    await ownerService.approveHelperJoin(join.id);
    const otherCase = await database.db.transaction((tx) => resolveContext(tx, turn, f.session));
    const otherInvite = await ownerService.inviteHelper({
      caseId: otherCase.caseId,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherJoin = await helperService.requestHelperJoin(otherInvite.token, helper.sessionId);
    await ownerService.approveHelperJoin(otherJoin.id);
    const stream = await f.send("Teilen stoppen");
    expect(await helperService.getHelperJoin(join.id)).toMatchObject({ status: "paused" });
    expect(await helperService.getHelperJoin(otherJoin.id)).toMatchObject({ status: "active" });
    const [actor] = await database.db
      .select()
      .from(caseActors)
      .where(and(eq(caseActors.userId, helper.userId), eq(caseActors.caseId, f.context.caseId)));
    expect(actor?.shareScope).toEqual({ mode: "restricted", case: false, factTypes: [] });
    expect(
      stream.some(
        (part) =>
          part.type === "data-speech-segment" &&
          SpeechSegmentSchema.parse(part.data).text.includes("pausiert"),
      ),
    ).toBe(true);
    expect(
      stream.some((part) => part.type === "text-delta" && part.delta.includes("pausiert")),
    ).toBe(true);
    expect(await f.service.read()).toEqual({ autonomyLevel: "L1" });
  });

  it("FR-R5 honors Pause while a tool approval is pending without approving or dispatching that tool", async () => {
    const f = await flow();
    await f.service.change({ autonomyLevel: "L2", confirmed: true });
    const context = { ...f.context, autonomyLevel: "L2" as const };
    const helper = await identity(database.db);
    const ownerService = createSubjectService(database, f.session.userId, f.session.sessionId);
    const helperService = createSubjectService(database, helper.userId, helper.sessionId);
    const invite = await ownerService.inviteHelper({
      caseId: context.caseId,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const join = await helperService.requestHelperJoin(invite.token, helper.sessionId);
    await ownerService.approveHelperJoin(join.id);
    const call = {
      approvalId: randomUUID(),
      toolCallId: randomUUID(),
      toolName: "ui.fill",
      input: fillInput,
    };
    const approvalContext = await createApprovalService(database.db, config.approvalSecret).request(
      call,
      context,
    );
    const signature = approvalHmac(
      {
        approvalId: call.approvalId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        inputHash: inputHash(call.input),
      },
      config.approvalSecret,
    );
    await database.db.transaction((tx) =>
      saveMessages(tx, context.caseId, [
        {
          id: randomUUID(),
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: call.toolName,
              toolCallId: call.toolCallId,
              state: "approval-requested",
              input: call.input,
              approval: { id: call.approvalId, signature },
            },
            { type: "data-approval-context", data: approvalContext },
          ],
        },
      ]),
    );
    const stream = await f.send("Pause");
    expect(await helperService.getHelperJoin(join.id)).toMatchObject({ status: "paused" });
    const [approval] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.approvalId, call.approvalId));
    expect(approval).toMatchObject({ decision: "pending", consumedAt: null });
    expect(stream.some((part) => part.type === "tool-input-available")).toBe(false);
    const last = (await loadMessages(database.db, context.caseId)).at(-1);
    expect(
      last?.parts.some(
        (part) => part.type === "dynamic-tool" && part.state === "approval-requested",
      ),
    ).toBe(true);
    expect(
      stream.some((part) => part.type === "text-delta" && part.delta.includes("pausiert")),
    ).toBe(true);
  });
});
