import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "process.start": { caseId: "stub-reference", slots: [], firstMissingSlot: null, steps: [] },
    "process.nextStep": { step: null, missingSlots: [], questionHint: "", actions: [] },
    "process.applyAnswers": {
      state: { caseId: "stub-reference", slots: [], firstMissingSlot: null, steps: [] },
      validationErrors: [],
    },
    "process.completeStep": { steps: [], reminders: [], preparedArtifacts: [] },
  });
}
