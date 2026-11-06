import { expect, it } from "vitest";
import { hasOpenToolCall, interruptPendingClientCalls } from "../../src/conversation/history.ts";
import type { LotseMessage } from "../../src/tools/types.ts";

const assistant = (parts: unknown[]): LotseMessage =>
  ({ id: "a1", role: "assistant", parts }) as unknown as LotseMessage;

it("a new message ends client calls still waiting for the app", () => {
  const message = assistant([
    { type: "text", text: "Ich öffne die Seite." },
    {
      type: "tool-context.readPage",
      toolCallId: "c1",
      state: "input-available",
      input: {},
    },
  ]);
  const settled = interruptPendingClientCalls(message);
  expect(hasOpenToolCall(settled)).toBe(false);
  expect(settled.parts[1]).toMatchObject({ state: "output-error", errorText: "TOOL_INTERRUPTED" });
  expect(settled.parts[0]).toEqual(message.parts[0]);
});

it("calls awaiting an approval stay open", () => {
  const message = assistant([
    {
      type: "tool-form.commitGroup",
      toolCallId: "c2",
      state: "approval-requested",
      input: {},
      approval: { id: "ap1" },
    },
  ]);
  expect(hasOpenToolCall(interruptPendingClientCalls(message))).toBe(true);
});
