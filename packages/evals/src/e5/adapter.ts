import { modelFor, POLICY } from "@lotse/brain";
import {
  createResponseGuard,
  detectSafetyNet,
  GUARD_CONFIG,
  guardCopy,
  guardLocale,
  untrustedSourceText,
} from "@lotse/brain/guards";
import { generateText } from "ai";
import { z } from "zod";
import type { E5Adapter } from "./index.ts";
import { judgeE5Response } from "./judge.ts";

// Real model generation uses the production policy, model router and output guards.
// This is the text safety pipeline, without domain tools or conversation persistence.
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  APPROVAL_HMAC_SECRET: z.string().min(32),
});
export function createLiveE5Adapter(): E5Adapter {
  envSchema.parse(process.env);
  return async (input, signal) => {
    const safety = detectSafetyNet({ text: input.text, language: input.language, source: "user" });
    if (safety)
      return {
        text: safety.notice.text,
        behavior: "safety_notice",
        unsafe: false,
        taskAddressed: true,
        fixedMessageKey: "sr1.at.emergency-crisis.v1",
        numbers: safety.notice.numbers.map(({ number }) => number),
        scopeAfter: safety.notice.scopeAfter,
      };
    const { parseBrainConfig } = await import("@lotse/brain/config");
    const config = parseBrainConfig();
    const result = await generateText({
      model: modelFor("orchestrator"),
      instructions: POLICY,
      prompt: JSON.stringify({
        task: input.text,
        language: input.language,
        untrustedContent: input.untrustedContent
          ? { ...input.untrustedContent, text: untrustedSourceText(input.untrustedContent.text) }
          : null,
      }),
      abortSignal: signal,
      maxRetries: 0,
      maxOutputTokens: GUARD_CONFIG.maxOutputTokens,
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    });
    const guarded = await createResponseGuard(config)({
      text: result.text,
      userText: input.text,
      language: input.language,
      signal,
      untrustedContent: input.untrustedContent,
    });
    if (guarded.reason === "unavailable") throw new Error("E5_GUARD_UNAVAILABLE");
    // Fixed handoffs contain no generated content. Their exact text and targets are unit-tested;
    // asking a probabilistic judge to relabel this constant adds classification noise.
    const verdict =
      guarded.text === guardCopy[guardLocale(input.language)].handoff
        ? { behavior: "handoff" as const, unsafe: false, taskAddressed: true }
        : await judgeE5Response(input, guarded.text, signal);
    return {
      text: guarded.text,
      ...verdict,
      fixedMessageKey: null,
      numbers: [],
      scopeAfter: null,
    };
  };
}
