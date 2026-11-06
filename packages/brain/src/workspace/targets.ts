import type { Action } from "@lotse/protocol";

/** Element ids the workspace gives a turn's result card and its tool row, so the cursor can point there. */
export const workspaceTargets = {
  resultCard: (toolCallId: string): string => `lotse-result-${toolCallId}`,
  toolRow: (toolCallId: string): string => `lotse-tool-${toolCallId}`,
  resultPrefix: "lotse-result-",
  toolPrefix: "lotse-tool-",
} as const;

/** Tools whose results the workspace shows as cards; the cursor prefers these. */
const CARD_TOOLS: ReadonlySet<string> = new Set([
  "catalog.findBenefits",
  "catalog.getBenefit",
  "documents.checklist",
  "eko.lookupCoverage",
  "fees.explainReimbursement",
  "office.resolve",
  "facility.search",
  "form.find",
  "process.nextStep",
]);

/** The result the answer talks about: the latest card tool, else the latest non-display tool. */
export function pointedToolCall(
  calls: readonly { toolCallId: string; toolName: string }[],
): string | undefined {
  const visible = calls.filter((call) => !call.toolName.startsWith("ui."));
  return (visible.findLast((call) => CARD_TOOLS.has(call.toolName)) ?? visible.at(-1))?.toolCallId;
}

/** Point at the result card while the first sentence is spoken. */
export function resultPointAction(id: string, toolCallId: string): Action {
  return {
    id,
    kind: "point",
    target: { kind: "ui", elementId: workspaceTargets.resultCard(toolCallId) },
    payload: {},
    sentenceIndex: 0,
  };
}
