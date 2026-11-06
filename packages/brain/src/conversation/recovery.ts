import { approvals } from "@lotse/db/schema";
import { getToolName, isToolUIPart } from "ai";
import { and, eq, isNotNull } from "drizzle-orm";
import { inputHash } from "../approvals/canonical.ts";
import type { Transaction } from "../approvals/index.ts";
import type { LotseMessage } from "../tools/types.ts";

export async function recoverConsumedCalls(
  tx: Transaction,
  caseId: string,
  history: LotseMessage[],
): Promise<LotseMessage[]> {
  const consumed = await tx
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.caseId, caseId),
        eq(approvals.decision, "approved"),
        isNotNull(approvals.consumedAt),
      ),
    );
  return history.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      // A restored client must not silently execute a screen read or another
      // unapproved capability from the previous client. Resolve its unfinished
      // call explicitly so the user can continue or request a fresh operation.
      if (isToolUIPart(part) && part.state === "input-available" && !part.approval)
        return { ...part, state: "output-error" as const, errorText: "TOOL_INTERRUPTED" };
      if (!isToolUIPart(part) || part.state !== "approval-responded" || !part.approval.approved)
        return part;
      const record = consumed.find((row) => row.approvalId === part.approval.id);
      if (
        !record ||
        record.toolCallId !== part.toolCallId ||
        record.toolName !== getToolName(part) ||
        record.inputHash !== inputHash(part.input)
      )
        return part;
      // Execution/dispatch may or may not have happened before the crash. Never
      // retry an uncertain operation with a consumed authorization. Keep the
      // approval consumed and expose an error; a retry needs a new tool call.
      return {
        ...part,
        state: "output-error" as const,
        errorText: "TOOL_INTERRUPTED",
        approval: { ...part.approval, approved: true as const },
      };
    }),
  }));
}
