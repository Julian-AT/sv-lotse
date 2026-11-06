import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "eko.lookupCoverage": {
      listed: false,
      box: null,
      approvalRequired: false,
      approvalRequestedBy: null,
      conditionsFlag: false,
      prescriptionFee: "",
      capRule: "",
      exemptionRule: "",
      sources: [],
    },
  });
}
