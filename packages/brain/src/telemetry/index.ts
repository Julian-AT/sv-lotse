import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { LanguageModelUsage } from "ai";
import { type BrainConfig, MODEL_PRICING, TOKENS_PER_MILLION } from "../config/index.ts";
import type { ToolName } from "../tools/contracts/index.ts";

type Pricing = BrainConfig["modelPricing"];
type TraceStage = "classification" | "safety_net" | "context" | "retrieval" | "guard" | "verifier";
export type TurnMetrics = {
  modelMs: number;
  toolMs: number;
  stageLatencies: Record<string, number>;
  caseCostUsd: number;
  caseCostComplete: boolean;
  budgetExceeded: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costComplete: boolean;
  unpricedCalls: number;
  modelCalls: number;
  toolCount: number;
};
export type TurnTelemetry = {
  run: <T>(callback: () => T) => T;
  stage: <T>(name: TraceStage, callback: () => Promise<T>) => Promise<T>;
  identify: (caseId: string, turnId: string) => void;
  recordPerformance: (model: number, tools: number) => void;
  caseBudget: (spent: number, budget: number | undefined, complete?: boolean) => boolean;
  recordModelStart: () => void;
  recordUsage: (modelId: string, usage: LanguageModelUsage, pricing: Pricing) => void;
  recordTool: (toolCallId: string) => void;
  dispatchTool: (toolName: ToolName, toolCallId: string, dispatch: () => void) => void;
  snapshot: () => TurnMetrics;
  modelIds: () => string[];
  end: (status: "completed" | "awaiting_approval" | "interrupted" | "failed") => void;
};

export function estimateModelCost(
  modelId: string,
  usage: LanguageModelUsage,
  pricing: Pricing = MODEL_PRICING,
): number | undefined {
  const price = pricing[modelId] ?? pricing[modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined) return;
  const cached = Math.min(usage.inputTokenDetails.cacheReadTokens ?? 0, usage.inputTokens);
  return (
    ((usage.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      usage.outputTokens * price.output) /
    TOKENS_PER_MILLION
  );
}

// This handle deliberately accepts only ids, usage and counts, never the SDK
// event itself: events also contain private messages and tool arguments.
export function startTurnTelemetry(): TurnTelemetry {
  const started = performance.now();
  const span = trace.getTracer("lotse.brain").startSpan("lotse.turn");
  const parent = trace.setSpan(context.active(), span);
  let ended = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let unpricedCalls = 0;
  let modelCalls = 0;
  let pendingCalls = 0;
  let modelMs = 0;
  let toolMs = 0;
  let previousCaseCostUsd = 0;
  let previousCaseCostComplete = true;
  let budgetExceeded = false;
  let budgetLimit: number | undefined;
  const toolCalls = new Set<string>();
  const models = new Set<string>();
  const stageLatencies: Record<string, number> = {};
  const snapshot = (): TurnMetrics => ({
    stageLatencies: { ...stageLatencies },
    modelMs,
    toolMs,
    caseCostUsd: previousCaseCostUsd + costUsd,
    caseCostComplete: previousCaseCostComplete && unpricedCalls === 0 && pendingCalls === 0,
    budgetExceeded: budgetLimit !== undefined && previousCaseCostUsd + costUsd >= budgetLimit,
    latencyMs: Math.max(0, performance.now() - started),
    inputTokens,
    outputTokens,
    costUsd,
    costComplete: unpricedCalls === 0 && pendingCalls === 0,
    unpricedCalls,
    modelCalls,
    toolCount: toolCalls.size,
  });
  return {
    run: <T>(callback: () => T): T => context.with(parent, callback),
    stage: async <T>(name: TraceStage, callback: () => Promise<T>): Promise<T> => {
      return context.with(parent, () =>
        trace.getTracer("lotse.brain").startActiveSpan(`lotse.${name}`, async (stage) => {
          const stageStarted = performance.now();
          try {
            return await callback();
          } catch (error) {
            stage.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            stageLatencies[name] = (stageLatencies[name] ?? 0) + performance.now() - stageStarted;
            stage.end();
          }
        }),
      );
    },
    identify: (caseId: string, turnId: string): void => {
      span.setAttributes({ "lotse.case.id": caseId, "lotse.turn.id": turnId });
    },
    recordPerformance: (model: number, tools: number): void => {
      modelMs += model;
      toolMs += tools;
    },
    caseBudget: (spent: number, budget: number | undefined, complete = true): boolean => {
      previousCaseCostComplete = complete;
      previousCaseCostUsd = spent;
      budgetLimit = budget;
      budgetExceeded = budget !== undefined && spent >= budget;
      span.setAttributes({
        "lotse.case.cost_usd": spent,
        "lotse.case.budget_exceeded": budgetExceeded,
      });
      if (budgetExceeded)
        span.addEvent("lotse.case.budget_exceeded", { "lotse.case.cost_usd": spent });
      return budgetExceeded;
    },
    recordModelStart: (): void => {
      pendingCalls++;
    },
    recordUsage: (modelId: string, usage: LanguageModelUsage, pricing: Pricing): void => {
      pendingCalls = Math.max(0, pendingCalls - 1);
      modelCalls++;
      models.add(modelId);
      inputTokens += usage.inputTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
      const cost = estimateModelCost(modelId, usage, pricing);
      if (cost === undefined) unpricedCalls++;
      else costUsd += cost;
    },
    recordTool: (toolCallId: string): void => {
      toolCalls.add(toolCallId);
    },
    dispatchTool: (toolName: ToolName, toolCallId: string, dispatch: () => void): void => {
      toolCalls.add(toolCallId);
      // Client tools have no SDK execute callback. Trace the authorized dispatch;
      // the actual capability result remains a separately validated continuation.
      context.with(parent, () =>
        trace.getTracer("lotse.brain").startActiveSpan(
          "lotse.tool.dispatch",
          {
            attributes: {
              "gen_ai.operation.name": "dispatch_tool",
              "gen_ai.tool.name": toolName,
              "gen_ai.tool.call.id": toolCallId,
            },
          },
          (toolSpan) => {
            try {
              dispatch();
            } catch (error) {
              toolSpan.setStatus({ code: SpanStatusCode.ERROR });
              throw error;
            } finally {
              toolSpan.end();
            }
          },
        ),
      );
    },
    snapshot,
    modelIds: (): string[] => [...models],
    end: (status: "completed" | "awaiting_approval" | "interrupted" | "failed"): void => {
      if (ended) return;
      ended = true;
      const metrics = snapshot();
      if (!budgetExceeded && budgetLimit !== undefined && metrics.caseCostUsd >= budgetLimit) {
        span.addEvent("lotse.case.budget_exceeded", { "lotse.case.cost_usd": metrics.caseCostUsd });
        span.setAttribute("lotse.case.budget_exceeded", true);
      }
      span.setAttributes({
        "lotse.turn.status": status,
        "lotse.turn.latency_ms": metrics.latencyMs,
        "lotse.case.cost_usd": metrics.caseCostUsd,
        "lotse.case.cost_complete": metrics.caseCostComplete,
        "lotse.turn.model_ms": modelMs,
        "lotse.turn.tools_ms": toolMs,
        "lotse.turn.tool_count": metrics.toolCount,
        "lotse.cost.usd": costUsd,
        "lotse.cost.complete": metrics.costComplete,
        "lotse.cost.unpriced_calls": unpricedCalls,
        "gen_ai.usage.input_tokens": inputTokens,
        "gen_ai.usage.output_tokens": outputTokens,
      });
      span.setStatus({ code: status === "failed" ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      span.end();
    },
  };
}
export {
  actionEvent,
  analyticsIdentifier,
  emitProductEvent,
  formIdentifier,
  guardEvent,
  heldUntilCommit,
  helperSessionEvent,
  observeGuard,
  type ProductEvent,
  type ProductEventSink,
  packageBuiltEvent,
  stepCompletedEvent,
  toolProductEvent,
} from "./product-events.ts";
