import { generateText, Output } from "ai";
import { z } from "zod";
import type { BrainConfig } from "../config/index.ts";
import { createModelRouter } from "../models/index.ts";
import { GuardProviderError, guardAbortSignal } from "./classifier.ts";
import { GUARD_CONFIG } from "./config.ts";
import { boundaryData } from "./data.ts";

const requestSchema = z.strictObject({ medicalJudgmentRequested: z.boolean() });

export async function medicalJudgmentRequested(
  config: BrainConfig,
  userTask: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  // Quoted document instructions are data, including when the user quotes them in their request.
  const directTask = userTask.normalize("NFKC").replace(/„[^“]*“|“[^”]*”|"[^"]*"|«[^»]*»/gu, " ");
  if (boundaryData.medicalRequests.some((rule) => rule.expression.test(directTask))) return true;
  if (!config.apiKey) throw new GuardProviderError();
  try {
    const result = await generateText({
      model: createModelRouter(config).modelFor("guard"),
      instructions: boundaryData.requestPrompt,
      prompt: JSON.stringify({ userTask }),
      output: Output.object({ schema: requestSchema }),
      maxRetries: 0,
      maxOutputTokens: GUARD_CONFIG.maxOutputTokens,
      abortSignal: guardAbortSignal(signal),
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    });
    return requestSchema.parse(result.output).medicalJudgmentRequested;
  } catch {
    signal?.throwIfAborted();
    throw new GuardProviderError();
  }
}
