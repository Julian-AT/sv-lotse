import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "appointment.search": [],
    "appointment.prepare": { callSheet: "", emailDraft: "", ics: "", bookingValues: [] },
  });
}
