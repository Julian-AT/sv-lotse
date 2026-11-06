import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import type { ToolExecutionOptions } from "ai";
import { expect, test, vi } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { createApprovalService } from "../../src/approvals/index.ts";
import type { GuardedResponse } from "../../src/guards/response.ts";
import {
  emitProductEvent,
  heldUntilCommit,
  observeGuard,
  type ProductEvent,
} from "../../src/telemetry/product-events.ts";
import { buildTools } from "../../src/tools/registry.ts";

vi.mock("../../src/tools/impl/handoff/index.ts", () => ({
  implementations: () => ({ "handoff.compose": async () => ({ documentKey: "summary-key" }) }),
}));

const context: RuntimeContext = {
  caseId: randomUUID(),
  subjectId: randomUUID(),
  actorId: randomUUID(),
  userId: randomUUID(),
  sessionId: randomUUID(),
  actorRole: "subject",
  autonomyLevel: "L2",
  shareScope: {},
  sentenceIndex: 0,
};
const handoff: ProductEvent = {
  event: "handoff_created",
  properties: { reason_category: "assistant_request" },
};

test("section 15 analytics sinks can never interrupt a product action", async () => {
  expect(() =>
    emitProductEvent(() => {
      throw new Error("sink failed");
    }, handoff),
  ).not.toThrow();
  const rejecting = vi.fn().mockRejectedValue(new Error("provider down"));
  emitProductEvent(rejecting, handoff);
  emitProductEvent(rejecting, undefined);
  emitProductEvent(undefined, handoff);
  await Promise.resolve();
  expect(rejecting).toHaveBeenCalledOnce();
});

test("section 15 events raised inside a transaction leave only after commit", () => {
  const sink = vi.fn();
  const events = heldUntilCommit(sink);
  events.sink(handoff);
  expect(sink).not.toHaveBeenCalled();
  events.commit();
  expect(sink).toHaveBeenCalledWith(handoff);
  events.sink(handoff);
  expect(sink).toHaveBeenCalledTimes(2);
});

test("section 15 guard observation reports blocked responses without changing them", async () => {
  const sink = vi.fn();
  const allowed: GuardedResponse = { text: "ok", disposition: "allow", reason: "allowed" };
  const results: GuardedResponse[] = [
    allowed,
    { text: "handoff", disposition: "handoff", reason: "rule" },
  ];
  const guard = observeGuard(async () => results.shift() ?? allowed, sink);
  expect((await guard({ text: "a" })).disposition).toBe("allow");
  expect((await guard({ text: "b" })).disposition).toBe("handoff");
  expect(sink.mock.calls).toEqual([
    [{ event: "boundary_guard_triggered", properties: { layer: "rule", category: "handoff" } }],
  ]);
});

test("section 15 tool results emit their product event through the injected sink", async () => {
  const sink = vi.fn();
  const tools = buildTools({ allowStubs: false, analytics: sink });
  const options = {
    toolCallId: "call",
    messages: [],
    context,
  } as unknown as ToolExecutionOptions<RuntimeContext>;
  await tools["handoff.compose"].execute?.({ caseId: context.caseId, scope: ["steps"] }, options);
  expect(sink).toHaveBeenCalledWith(handoff);
});

test("section 15 approval requests emit action_proposed with type, method and level only", async () => {
  const sink = vi.fn();
  const values = vi.fn().mockResolvedValue(undefined);
  const db = {
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ insert: () => ({ values }) }),
  } as unknown as DatabaseClient;
  await createApprovalService(db, "approval-secret-for-unit-tests-32chars", sink).request(
    {
      approvalId: randomUUID(),
      toolCallId: "call",
      toolName: "calendar.createEvent",
      input: { ics: "BEGIN:VCALENDAR\nSUMMARY:private\nEND:VCALENDAR" },
    },
    context,
  );
  expect(sink.mock.calls).toEqual([
    [
      {
        event: "action_proposed",
        properties: {
          action_type: "calendar.create_event",
          target_method: "api",
          autonomy_level: "L2",
        },
      },
    ],
  ]);
});
