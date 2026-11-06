import type { LanguageModelUsage } from "ai";
import { expect, test } from "vitest";
import { parseBrainConfig } from "../../src/config/index.ts";
import { estimateModelCost, startTurnTelemetry } from "../../src/telemetry/index.ts";

const usage: LanguageModelUsage = {
  inputTokens: 1_000,
  inputTokenDetails: { noCacheTokens: 600, cacheReadTokens: 400, cacheWriteTokens: undefined },
  outputTokens: 200,
  outputTokenDetails: { textTokens: 100, reasoningTokens: 100 },
  totalTokens: 1_200,
};

test("NFR-12 counts cached input once and includes reasoning in output cost", () => {
  expect(estimateModelCost("gpt-5.4-mini-2026-03-17", usage)).toBeCloseTo(0.00138);
  expect(estimateModelCost("unpriced-model", usage)).toBeUndefined();
  expect(estimateModelCost("gpt-5.4-mini", { ...usage, outputTokens: undefined })).toBeUndefined();
});

test("NFR-12 validates price overrides without exposing malformed environment values", () => {
  const environment = { APPROVAL_HMAC_SECRET: "s".repeat(32) };
  expect(() =>
    parseBrainConfig({ ...environment, LOTSE_MODEL_PRICING_JSON: "secret-invalid" }),
  ).toThrow("LOTSE_MODEL_PRICING_JSON");
  expect(() => parseBrainConfig({ ...environment, LOTSE_CASE_BUDGET_USD: "-1" })).toThrow(
    "LOTSE_CASE_BUDGET_USD",
  );
  const config = parseBrainConfig({
    ...environment,
    LOTSE_MODEL_PRICING_JSON: '{"custom":{"input":1,"cachedInput":0.1,"output":2}}',
  });
  expect(estimateModelCost("custom", usage, config.modelPricing)).toBeCloseTo(0.00104);
});

test("NFR-12 aggregates steps and reports unknown costs instead of claiming zero cost", () => {
  const telemetry = startTurnTelemetry();
  telemetry.caseBudget(0.25, 0.2);
  telemetry.recordModelStart();
  expect(telemetry.snapshot().costComplete).toBe(false);
  telemetry.recordUsage(
    "gpt-5.4-mini",
    usage,
    parseBrainConfig({ APPROVAL_HMAC_SECRET: "s".repeat(32) }).modelPricing,
  );
  telemetry.recordTool("same-call");
  telemetry.recordTool("same-call");
  telemetry.recordPerformance(200, 50);
  expect(telemetry.snapshot()).toMatchObject({
    inputTokens: 1_000,
    outputTokens: 200,
    costComplete: true,
    costUsd: 0.00138,
    caseCostUsd: 0.25138,
    budgetExceeded: true,
    modelCalls: 1,
    toolCount: 1,
    modelMs: 200,
    toolMs: 50,
  });
  telemetry.recordUsage("unknown", usage, {});
  expect(telemetry.snapshot()).toMatchObject({
    costComplete: false,
    unpricedCalls: 1,
    inputTokens: 2_000,
  });
  telemetry.end("completed");
  telemetry.end("failed");
});
