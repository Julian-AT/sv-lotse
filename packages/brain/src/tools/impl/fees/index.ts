import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "fees.explainReimbursement": {
      ruleText: "",
      requiredDocuments: [],
      channels: {},
      illustrativeAmount: null,
      asOf: "2026-01-01",
      illustrative: true,
      sources: [],
    },
  });
}
