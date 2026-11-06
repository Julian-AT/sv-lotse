import type { ToolName } from "./contracts/index.ts";
import type { Implementations, ToolDependencies } from "./types.ts";
export class ToolNotImplementedError extends Error {
  readonly code = "TOOL_NOT_IMPLEMENTED";
  constructor(readonly toolName: ToolName) {
    super(`Tool not implemented: ${toolName}`);
    this.name = "ToolNotImplementedError";
  }
}
// Build-time fixtures exist exclusively behind the validated explicit opt-in.
// The registry validates their outputs against the same contract as real tools.
export function stubGroup(
  deps: ToolDependencies,
  fixtures: Partial<Record<ToolName, unknown>>,
): Implementations {
  return Object.fromEntries(
    Object.entries(fixtures).map(([name, fixture]) => [
      name,
      async () => {
        if (!deps.allowStubs) throw new ToolNotImplementedError(name as ToolName);
        return structuredClone(fixture);
      },
    ]),
  );
}
