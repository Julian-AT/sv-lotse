import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";

const contentAttributes = [
  "gen_ai.input",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.tool.definitions",
  "ai.request.text",
  "ai.request.audio",
  "ai.response.audio",
  "ai.response.transcript",
  "ai.response.segments",
  "ai.settings.headers",
  "ai.runtimeContext",
  "ai.toolsContext",
  "ai.schema",
  "ai.settings.output",
  "ai.documents",
  "ai.ranking",
  "ai.decision",
  "ai.prompt",
  "ai.response.text",
  "ai.response.object",
  "ai.response.reasoning",
  "ai.response.toolCalls",
  "ai.response.files",
  "ai.response.providerMetadata",
  "ai.toolCall.args",
  "ai.toolCall.result",
  "ai.value",
  "ai.values",
  "ai.embedding",
  "ai.embeddings",
  "langfuse.observation.input",
  "langfuse.observation.output",
  "langfuse.observation.metadata",
  "langfuse.trace.input",
  "langfuse.trace.output",
  "langfuse.trace.metadata",
  "exception.message",
  "exception.stacktrace",
];

const safeGenAiAttributes = new Set([
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.response.id",
  "gen_ai.response.finish_reasons",
  "gen_ai.output.type",
  "gen_ai.request.stream",
  "gen_ai.agent.name",
  "gen_ai.tool.name",
  "gen_ai.tool.call.id",
  "gen_ai.tool.type",
]);

function isSafeAttribute([key, value]: [string, unknown]): boolean {
  // Fail closed for new GenAI content fields, including speech/transcription.
  if (key.startsWith("gen_ai.")) {
    return (
      safeGenAiAttributes.has(key) || (key.startsWith("gen_ai.usage.") && typeof value === "number")
    );
  }
  return !contentAttributes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

export function redactSpanContent(processor: SpanProcessor): SpanProcessor {
  return {
    onStart: (span, context) => processor.onStart(span, context),
    onEnd(span) {
      // Langfuse's mask does not cover GenAI attributes or exception details.
      // Remove content before its onEnd hook can inspect, upload, log or export it.
      const attributes = Object.fromEntries(
        Object.entries(span.attributes).filter(isSafeAttribute),
      );
      const events = span.events.map((event) => ({
        ...event,
        attributes: Object.fromEntries(
          Object.entries(event.attributes ?? {}).filter(isSafeAttribute),
        ),
      }));
      processor.onEnd({
        ...span,
        spanContext: () => span.spanContext(),
        attributes,
        events,
        status: { code: span.status.code },
      });
    },
    forceFlush: () => processor.forceFlush(),
    shutdown: () => processor.shutdown(),
  };
}

export async function initializeTelemetry() {
  const { getEnvironment } = await import("./env.ts");
  const config = getEnvironment(); // Fail at process startup, before serving requests.
  const [{ registerTelemetry }, { OpenTelemetry }] = await Promise.all([
    import("ai"),
    import("@ai-sdk/otel"),
  ]);
  if (config.LANGFUSE_PUBLIC_KEY && config.LANGFUSE_SECRET_KEY) {
    const [{ LangfuseSpanProcessor }, { NodeTracerProvider }] = await Promise.all([
      import("@langfuse/otel"),
      import("@opentelemetry/sdk-trace-node"),
    ]);
    const provider = new NodeTracerProvider({
      spanProcessors: [
        redactSpanContent(
          new LangfuseSpanProcessor({
            publicKey: config.LANGFUSE_PUBLIC_KEY,
            secretKey: config.LANGFUSE_SECRET_KEY,
            baseUrl: config.LANGFUSE_BASE_URL,
            mask: () => "[redacted]",
            mediaUploadEnabled: false,
            shouldExportSpan: ({ otelSpan }) =>
              otelSpan.instrumentationScope.name === "lotse.brain" ||
              Object.keys(otelSpan.attributes).some((key) => key.startsWith("gen_ai.")),
          }),
        ),
      ],
    });
    provider.register();
    process.once("SIGTERM", () => {
      void provider.shutdown();
    });
  }
  registerTelemetry(new OpenTelemetry({ runtimeContext: false, headers: false }));
}
