import type { DatabaseClient } from "@lotse/db";
import type { ContextCapsule, LotseDataParts } from "@lotse/protocol";
import type { ToolExecutionOptions, UIMessage, UIMessageStreamWriter } from "ai";
import type { RuntimeContext } from "../agent/context.ts";
import type { ObjectStorage } from "../case-file/schema.ts";
import type { BrainConfig } from "../config/index.ts";
import type { Passage } from "../retrieval/index.ts";
import type { ProductEventSink } from "../telemetry/product-events.ts";
import type { ToolName } from "./contracts/index.ts";
export type LotseMessage = UIMessage<unknown, LotseDataParts>;
export type Execution = (
  input: unknown,
  context: RuntimeContext,
  options: ToolExecutionOptions<RuntimeContext>,
) => Promise<unknown>;
export type Implementations = Partial<Record<ToolName, Execution>>;
export type ToolDependencies = {
  config?: BrainConfig;
  passages?: Map<string, Passage>;
  allowStubs: boolean;
  db?: DatabaseClient;
  storage?: ObjectStorage;
  writer?: Pick<UIMessageStreamWriter<LotseMessage>, "write">;
  /** The turn's screen/page capsule, used to check whether a resource is already open. */
  capsule?: ContextCapsule;
  /** Consent-gated product analytics sink injected by the host; absent means nothing is sent. */
  analytics?: ProductEventSink;
};
export class ToolDependencyError extends Error {
  readonly code = "TOOL_DATABASE_REQUIRED";
  constructor() {
    super("Database is required for this tool");
    this.name = "ToolDependencyError";
  }
}

export function requireDatabase(deps: ToolDependencies): DatabaseClient {
  if (!deps.db) throw new ToolDependencyError();
  return deps.db;
}
