import { fillLiveForm } from "../../../forms/instances/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "form.fillLive": async (raw, context, options) =>
      fillLiveForm(requireDatabase(deps), deps, raw, context, options.abortSignal),
  };
}
