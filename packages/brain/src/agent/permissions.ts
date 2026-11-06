import { contracts, toolNames } from "../tools/contracts/index.ts";
import type { RuntimeContext } from "./context.ts";

export function allowedToolNames(
  level: RuntimeContext["autonomyLevel"],
  role: RuntimeContext["actorRole"],
) {
  return toolNames.filter((name) => {
    if (level === "L1" && (contracts[name].approval || name === "form.fillLive")) return false;
    if (
      role === "helper" &&
      (contracts[name].approval ||
        name === "form.fillLive" ||
        name === "case.update" ||
        name === "reminder.create")
    )
      return false;
    return true;
  });
}
