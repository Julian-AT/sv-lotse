import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { withLanguageFallback } from "../../src/models/index.ts";
import { withProviderToolNames } from "../../src/models/tool-names.ts";
import { forcedModel } from "./helpers.ts";

describe("OpenAI model routing", () => {
  it("preserves PRD tool names while translating provider requests and streamed calls", async () => {
    const provider = forcedModel("lotse_ui_fill");
    const model = withProviderToolNames(provider);
    const result = await model.doStream({
      prompt: [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call", toolName: "ui.fill", input: {} }],
        },
      ],
      tools: [
        { type: "function", name: "ui.fill", inputSchema: { type: "object", properties: {} } },
      ],
      toolChoice: { type: "tool", toolName: "ui.fill" },
    });
    expect(provider.doStreamCalls[0]?.tools?.[0]?.name).toBe("lotse_ui_fill");
    expect(provider.doStreamCalls[0]?.toolChoice).toEqual({
      type: "tool",
      toolName: "lotse_ui_fill",
    });
    expect(JSON.stringify(provider.doStreamCalls[0]?.prompt)).toContain("lotse_ui_fill");
    const reader = result.stream.getReader();
    let toolName: string | undefined;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.type === "tool-call") toolName = next.value.toolName;
    }
    expect(toolName).toBe("ui.fill");
  });
  it("uses the configured fallback when the primary fails before streaming", async () => {
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("Provider unavailable");
      },
    });
    const fallback = forcedModel();
    const result = await withLanguageFallback(primary, fallback).doStream({ prompt: [] });
    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(fallback.doStreamCalls).toHaveLength(1);
  });
});
