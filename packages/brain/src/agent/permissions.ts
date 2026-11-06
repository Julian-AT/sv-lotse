import { contracts, type ToolName, toolNames } from "../tools/contracts/index.ts";
import type { RuntimeContext } from "./context.ts";

const HELPER_DENIED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "form.fillLive",
  "case.update",
  "process.completeStep",
  "package.build",
  "reminder.create",
  "reminder.extract",
  "reminder.list",
  "docs.explainLetter",
]);

export function allowedToolNames(
  level: RuntimeContext["autonomyLevel"],
  role: RuntimeContext["actorRole"],
): ToolName[] {
  return toolNames.filter((name) => {
    if (level === "L1" && (contracts[name].approval || name === "form.fillLive")) return false;
    if (role === "helper" && (contracts[name].approval || HELPER_DENIED_TOOLS.has(name)))
      return false;
    return true;
  });
}
