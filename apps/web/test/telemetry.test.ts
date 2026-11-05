import { OpenTelemetry } from "@ai-sdk/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { generateSpeech, generateText, TypeValidationError } from "ai";
import { MockLanguageModelV4, MockSpeechModelV4 } from "ai/test";
import { expect, test, vi } from "vitest";
import { redactSpanContent } from "../src/server/telemetry.ts";

test("telemetry removes AI SDK content before Langfuse media processing and export", async () => {
  const sentinel = "sensitive-document-and-form-sentinel";
  const exporter = new InMemorySpanExporter();
  const langfuse = new LangfuseSpanProcessor({
    publicKey: "unit-public",
    secretKey: "unit-secret",
    exporter,
    mediaUploadEnabled: true,
    mask: () => "[redacted]",
  });
  const beforeMediaProcessing = vi.spyOn(langfuse, "onEnd");
  const provider = new BasicTracerProvider({ spanProcessors: [redactSpanContent(langfuse)] });
  const content = JSON.stringify([
    { role: "user", parts: [{ type: "text", content: sentinel }] },
    {
      role: "user",
      parts: [
        {
          type: "blob",
          mime_type: "text/plain",
          content: Buffer.from(sentinel).toString("base64"),
        },
      ],
    },
  ]);
  try {
    const span = provider.getTracer("ai").startSpan("chat", {
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "unit-model",
        "gen_ai.usage.input_tokens": 12,
        "error.type": "AI_TypeValidationError",
        "http.response.status_code": 400,
        "exception.message": sentinel,
        "exception.stacktrace": sentinel,
        "gen_ai.input.messages": content,
        "gen_ai.output.messages": content,
        "gen_ai.system_instructions": sentinel,
        "gen_ai.tool.call.arguments": sentinel,
        "gen_ai.tool.call.result": sentinel,
        "gen_ai.tool.definitions": sentinel,
        "gen_ai.request.speech.text": sentinel,
        "gen_ai.output.audio": sentinel,
        "gen_ai.transcription.text": sentinel,
        "gen_ai.future.messages": sentinel,
        "ai.request.text": sentinel,
        "ai.response.transcript": sentinel,
        "ai.response.segments": sentinel,
        "ai.request.audio.media_type": sentinel,
        "ai.response.audio": sentinel,
        "ai.runtimeContext.userId": sentinel,
        "ai.toolsContext": sentinel,
        "ai.prompt": sentinel,
        "ai.response.text": sentinel,
        "ai.toolCall.args": sentinel,
        "ai.toolCall.result": sentinel,
        "ai.value": sentinel,
        "ai.values": [sentinel],
        "langfuse.observation.input": content,
        "langfuse.observation.output": content,
      },
    });
    span.setStatus({ code: 2, message: sentinel });
    span.addEvent("exception", {
      "exception.type": "AI_TypeValidationError",
      "exception.message": sentinel,
      "exception.stacktrace": sentinel,
      "error.code": "INVALID_INPUT",
    });
    span.end();
    expect(beforeMediaProcessing).toHaveBeenCalledOnce();
    const received = beforeMediaProcessing.mock.calls[0]?.[0];
    expect(JSON.stringify(received)).not.toContain(sentinel);
    expect(received?.status).toEqual({ code: 2 });
    expect(received?.events[0]?.attributes).toEqual({
      "exception.type": "AI_TypeValidationError",
      "error.code": "INVALID_INPUT",
    });
    expect(JSON.stringify(received?.attributes)).not.toContain(sentinel);
    expect(JSON.stringify(received?.attributes)).not.toContain(
      Buffer.from(sentinel).toString("base64"),
    );
    await provider.forceFlush();
    const exported = exporter.getFinishedSpans();
    expect(exported).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain(sentinel);
    expect(JSON.stringify(exported[0]?.attributes)).not.toContain(sentinel);
    expect(JSON.stringify(exported[0]?.attributes)).not.toContain(
      Buffer.from(sentinel).toString("base64"),
    );
    expect(exported[0]?.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "unit-model",
      "gen_ai.usage.input_tokens": 12,
      "error.type": "AI_TypeValidationError",
      "http.response.status_code": 400,
    });
  } finally {
    await provider.shutdown();
  }
});

test.each([true, false])(
  "telemetry removes validation error content with input/output recording set to %s",
  async (recordContent) => {
    const sentinel = "sensitive-validation-value-sentinel";
    const error = new TypeValidationError({
      value: { formValue: sentinel },
      cause: new Error("Invalid form value"),
    });
    const errorType = recordContent ? error.name : "Error";
    expect(error.message).toContain(sentinel);
    expect(error.stack).toContain(sentinel);
    const exporter = new InMemorySpanExporter();
    const langfuse = new LangfuseSpanProcessor({
      publicKey: "unit-public",
      secretKey: "unit-secret",
      exporter,
      mediaUploadEnabled: false,
      mask: () => "[redacted]",
    });
    const beforeProcessing = vi.spyOn(langfuse, "onEnd");
    const provider = new BasicTracerProvider({ spanProcessors: [redactSpanContent(langfuse)] });
    try {
      // Only the model is a unit-test double. AI SDK 7 records the real validation
      // error through its telemetry integration, including when content is disabled.
      await expect(
        generateText({
          model: new MockLanguageModelV4({
            doGenerate: async () => {
              throw error;
            },
          }),
          prompt: "Validate the supplied value",
          maxRetries: 0,
          telemetry: {
            recordInputs: recordContent,
            recordOutputs: recordContent,
            integrations: new OpenTelemetry({ tracer: provider.getTracer("ai") }),
          },
        }),
      ).rejects.toBe(error);
      expect(beforeProcessing).toHaveBeenCalled();
      const received = beforeProcessing.mock.calls.map(([span]) => span);
      expect(JSON.stringify(received)).not.toContain(sentinel);
      expect(received.some((span) => span.events.some((event) => event.name === "exception"))).toBe(
        true,
      );
      for (const span of received) {
        expect(span.status).toEqual({ code: 2 });
        for (const event of span.events) {
          if (event.name === "exception") {
            expect(event.attributes).toEqual({ "exception.type": errorType });
          }
        }
      }
      await provider.forceFlush();
      const exported = exporter.getFinishedSpans();
      expect(exported).toHaveLength(received.length);
      expect(JSON.stringify(exported)).not.toContain(sentinel);
      expect(exported.every((span) => span.status.code === 2)).toBe(true);
      expect(
        exported.some((span) =>
          span.events.some((event) => event.attributes?.["exception.type"] === errorType),
        ),
      ).toBe(true);
    } finally {
      await provider.shutdown();
    }
  },
);

test("speech generation masks its real SDK request text before export", async () => {
  const sentinel = "private-spoken-content-sentinel";
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [redactSpanContent(new SimpleSpanProcessor(exporter))],
  });
  try {
    await generateSpeech({
      model: new MockSpeechModelV4({
        doGenerate: async () => ({
          audio: new Uint8Array([1, 2, 3]),
          warnings: [],
          response: { timestamp: new Date(), modelId: "speech-unit" },
        }),
      }),
      text: sentinel,
      telemetry: {
        recordInputs: true,
        recordOutputs: true,
        integrations: new OpenTelemetry({ tracer: provider.getTracer("gen_ai") }),
      },
    });
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    expect(JSON.stringify(spans)).not.toContain(sentinel);
    expect(
      spans.some((span) => span.attributes["gen_ai.operation.name"] === "ai.generateSpeech"),
    ).toBe(true);
  } finally {
    await provider.shutdown();
  }
});
