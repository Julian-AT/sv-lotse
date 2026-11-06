import type { DatabaseClient } from "@lotse/db";
import type { LotseDataParts } from "@lotse/protocol";
import type { ToolExecutionOptions, UIMessage, UIMessageStreamWriter } from "ai";
import type { RuntimeContext } from "../agent/context.ts";
import type { ToolName } from "./contracts/index.ts";
export type LotseMessage = UIMessage<unknown, LotseDataParts>;
export type Execution = (
  input: unknown,
  context: RuntimeContext,
  options: ToolExecutionOptions<RuntimeContext>,
) => Promise<unknown>;
export type Implementations = Partial<Record<ToolName, Execution>>;
export type ToolDependencies = {
  allowStubs: boolean;
  db?: DatabaseClient;
  writer?: Pick<UIMessageStreamWriter<LotseMessage>, "write">;
};
export function requireDatabase(deps: ToolDependencies): DatabaseClient {
  if (!deps.db) throw new Error("Database is required for this tool");
  return deps.db;
}
