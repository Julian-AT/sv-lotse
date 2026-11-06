import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "catalog.findBenefits": [],
    "catalog.getBenefit": {
      id: "stub-reference",
      name_de: "Build-time fixture",
      name_simple: "Build-time fixture",
      area: "A",
      life_situations: [],
      scope: "social_insurance",
      carriers: [],
      office_rules: [],
      documents: [],
      forms: [],
      process: "stub-reference",
      appointment_channels: [],
      as_of: "2026-01-01",
      verified_at: "2026-01-01",
      criteria: [],
      sources: [],
    },
  });
}
