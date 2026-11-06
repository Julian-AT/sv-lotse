import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "office.resolve": {
      id: "stub-reference",
      title: "Build-time fixture",
      address: { street: "", postalCode: "", city: "" },
      channels: {},
      openingHours: "",
      sources: [],
    },
  });
}
