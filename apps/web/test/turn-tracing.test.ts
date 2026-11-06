import { OpenTelemetry } from "@ai-sdk/otel";
import { startTurnTelemetry } from "@lotse/brain/telemetry";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { generateText, isStepCount, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";
import { z } from "zod";
import { redactSpanContent } from "../src/server/telemetry.ts";

test("section 15 links real SDK model and tool spans to the turn and excludes content", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [redactSpanContent(new SimpleSpanProcessor(exporter))],
  });
  provider.register();
  const tracer = provider.getTracer("gen_ai");
  const sentinel = "private-tool-and-message-sentinel";
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content:
        calls++ === 0
          ? [
              {
                type: "tool-call",
                toolCallId: "unit-call",
                toolName: "lookup",
                input: JSON.stringify({ value: sentinel }),
              },
            ]
          : [{ type: "text", text: sentinel }],
      finishReason: { unified: calls === 1 ? "tool-calls" : "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  try {
    const turn = startTurnTelemetry();
    await turn.stage("context", async () => undefined);
    await turn.run(() =>
      generateText({
        model,
        prompt: sentinel,
        tools: {
          lookup: tool({
            inputSchema: z.object({ value: z.string() }),
            execute: async () => ({ value: sentinel }),
          }),
        },
        stopWhen: isStepCount(2),
        telemetry: {
          recordInputs: true,
          recordOutputs: true,
          integrations: new OpenTelemetry({ tracer }),
        },
      }),
    );
    turn.dispatchTool("ui.fill", "client-unit-call", () => {});
    turn.end("completed");
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((span) => span.name === "lotse.turn");
    expect(parent).toBeDefined();
    expect(
      spans.filter((span) => span.attributes["gen_ai.operation.name"] === "execute_tool"),
    ).toHaveLength(1);
    expect(spans.find((span) => span.name === "lotse.context")?.parentSpanContext?.spanId).toBe(
      parent?.spanContext().spanId,
    );
    expect(
      spans.every((span) => span.spanContext().traceId === parent?.spanContext().traceId),
    ).toBe(true);
    expect(JSON.stringify(spans)).not.toContain(sentinel);
    expect(parent?.attributes["lotse.turn.latency_ms"]).toBeGreaterThanOrEqual(0);
  } finally {
    await provider.shutdown();
  }
});
