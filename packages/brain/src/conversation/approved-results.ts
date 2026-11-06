import { isToolUIPart, type ToolExecutionEndEvent } from "ai";
import type { RuntimeTools } from "../tools/registry.ts";
import { ToolNotImplementedError } from "../tools/stubs.ts";
import type { LotseMessage } from "../tools/types.ts";

// The SDK executes resumed server approvals before its first model step and
// emits no finish-step for them. Checkpoint those results at execution end.
export function approvedResultCheckpoint(
  history: LotseMessage[],
  save: (history: LotseMessage[]) => Promise<void>,
): (event: ToolExecutionEndEvent<RuntimeTools>) => Promise<void> {
  let resumed = structuredClone(history);
  let pending = Promise.resolve();
  return (event) => {
    pending = pending.then(async () => {
      let changed = false;
      resumed = resumed.map((message) => ({
        ...message,
        parts: message.parts.map((part) => {
          if (
            !isToolUIPart(part) ||
            part.toolCallId !== event.toolCall.toolCallId ||
            part.state !== "approval-responded" ||
            !part.approval.approved
          )
            return part;
          changed = true;
          const approval = { ...part.approval, approved: true as const };
          return event.toolOutput.type === "tool-result"
            ? {
                ...part,
                state: "output-available" as const,
                approval,
                output: event.toolOutput.output,
              }
            : {
                ...part,
                state: "output-error" as const,
                approval,
                errorText:
                  event.toolOutput.error instanceof ToolNotImplementedError
                    ? event.toolOutput.error.code
                    : "TOOL_FAILED",
              };
        }),
      }));
      if (changed) await save(resumed);
    });
    return pending;
  };
}
