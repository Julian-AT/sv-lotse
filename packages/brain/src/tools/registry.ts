import { type Tool, type ToolExecutionOptions, tool } from "ai";
import { type RuntimeContext, runtimeContextSchema } from "../agent/context.ts";
import { allowedToolNames } from "../agent/permissions.ts";
import { contracts, type ToolName, toolNames } from "./contracts/index.ts";
import { implementations as appointment } from "./impl/appointment/index.ts";
import { implementations as caseTools } from "./impl/case/index.ts";
import { implementations as catalog } from "./impl/catalog/index.ts";
import { implementations as context } from "./impl/context/index.ts";
import { implementations as docs } from "./impl/docs/index.ts";
import { implementations as documents } from "./impl/documents/index.ts";
import { implementations as eko } from "./impl/eko/index.ts";
import { implementations as facility } from "./impl/facility/index.ts";
import { implementations as fees } from "./impl/fees/index.ts";
import { implementations as form } from "./impl/form/index.ts";
import { implementations as formLive } from "./impl/form-live/index.ts";
import { implementations as handoff } from "./impl/handoff/index.ts";
import { implementations as kb } from "./impl/kb/index.ts";
import { implementations as office } from "./impl/office/index.ts";
import { implementations as process } from "./impl/process/index.ts";
import { implementations as reminder } from "./impl/reminder/index.ts";
import { implementations as ui } from "./impl/ui/index.ts";
import type { Implementations, ToolDependencies } from "./types.ts";

export type RuntimeTools = Record<ToolName, Tool<unknown, unknown, RuntimeContext>>;
export function buildTools(deps: ToolDependencies): RuntimeTools {
  const implementations: Implementations = {};
  for (const group of [
    catalog,
    process,
    kb,
    office,
    facility,
    appointment,
    form,
    documents,
    docs,
    eko,
    fees,
    caseTools,
    reminder,
    handoff,
    context,
    ui,
    formLive,
  ])
    Object.assign(implementations, group(deps));
  return Object.fromEntries(
    toolNames.map((name) => {
      const contract = contracts[name];
      const execute = implementations[name];
      if (contract.location !== "client" && !execute)
        throw new Error(`Missing implementation: ${name}`);
      const definition = {
        description: contract.description,
        inputSchema: contract.input,
        outputSchema: contract.output,
        contextSchema: runtimeContextSchema,
      };
      if (contract.location === "client")
        return [name, tool<unknown, unknown, RuntimeContext>(definition)];
      return [
        name,
        tool<unknown, unknown, RuntimeContext>({
          ...definition,
          execute: async (input: unknown, options: ToolExecutionOptions<RuntimeContext>) => {
            // Stub calls still fail closed even when invoked without runtime context.
            if (!execute) throw new Error("Missing tool implementation");
            if (
              options.context &&
              !allowedToolNames(options.context.autonomyLevel, options.context.actorRole).includes(
                name,
              )
            )
              throw new Error("Tool permission denied");
            return contract.output.parse(
              await execute(contract.input.parse(input), options.context, options),
            );
          },
        }),
      ];
    }),
  ) as RuntimeTools;
}
