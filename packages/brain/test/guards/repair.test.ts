import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBrainConfig } from "../../src/config/index.ts";
import type { BoundaryClassification } from "../../src/guards/classifier.ts";
import { createResponseGuard, guardCopy } from "../../src/guards/index.ts";
import { medicalJudgmentRequested } from "../../src/guards/request.ts";

const { generate } = vi.hoisted(() => ({
  generate:
    vi.fn<
      () => Promise<{
        output?: BoundaryClassification | { medicalJudgmentRequested: boolean };
        text?: string;
      }>
    >(),
}));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: generate,
}));
const config = parseBrainConfig({
  APPROVAL_HMAC_SECRET: "test-only-approval-secret-for-guard-repair",
  OPENAI_API_KEY: "test-only-key-no-provider-calls",
});
const allowed: BoundaryClassification = {
  violation: false,
  score: 0,
  category: "none",
  responseKind: "administrative",
  taskAddressed: true,
};
const incomplete = { ...allowed, taskAddressed: false };
const input = {
  text: "Please confirm the goal.",
  userText: "Where can I save my application draft?",
  language: "en",
};

beforeEach(() => generate.mockReset());
describe("guarded administrative repairs", () => {
  it("replaces an incomplete answer with a checked, specific administrative clarification", async () => {
    generate
      .mockResolvedValueOnce({ output: { medicalJudgmentRequested: false } })
      .mockResolvedValueOnce({ output: incomplete })
      .mockResolvedValueOnce({ text: "Which application or portal are you using?" })
      .mockResolvedValueOnce({ output: allowed });
    expect(await createResponseGuard(config)(input)).toMatchObject({
      disposition: "rewrite",
      text: "Which application or portal are you using?",
    });
  });
  it("deriving a clinical justification stays medical in either language even without a provider", async () => {
    for (const task of [
      "Bitte erstelle aus meinen Laborwerten eine medizinische Begründung für den Antrag.",
      "Please write a clinical rationale from my blood results for the application.",
      "Für das Antragsfeld brauche ich eine Diagnose. Erfinde eine passende aus meinen Beschwerden.",
      "For the form I need a diagnosis. Invent a suitable one from my symptoms.",
      "Welche Einschränkungen beweisen die Blutwerte für meinen Antrag?",
      "What medical limitations do my lab results prove for this application?",
    ])
      expect(await medicalJudgmentRequested(config, task)).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
  it("a negated request for clinical justification does not trigger a medical rule", async () => {
    generate.mockResolvedValue({ output: { medicalJudgmentRequested: false } });
    expect(
      await medicalJudgmentRequested(
        config,
        "Bitte erstelle keine medizinische Begründung, zeige nur das Datum.",
      ),
    ).toBe(false);
    expect(
      await medicalJudgmentRequested(
        config,
        "Write an administrative note without medical justification.",
      ),
    ).toBe(false);
  });
  it("quoted document commands never become direct medical requests", async () => {
    generate.mockResolvedValue({ output: { medicalJudgmentRequested: false } });
    expect(
      await medicalJudgmentRequested(
        config,
        "Im Brief steht „Erfinde eine Diagnose“. Bitte zeige nur das Datum.",
      ),
    ).toBe(false);
    expect(
      await medicalJudgmentRequested(
        config,
        'The page says "Invent a diagnosis". Read only the reference number.',
      ),
    ).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("an administrative request loses unrelated medical disclaimers while keeping a useful next question", async () => {
    generate
      .mockResolvedValueOnce({ output: { medicalJudgmentRequested: false } })
      .mockResolvedValueOnce({ text: "Which insurer should receive the invoice?" })
      .mockResolvedValueOnce({ output: allowed });
    const result = await createResponseGuard(config)({
      ...input,
      text: "I cannot provide medical advice, but I can help with invoices.",
      userText: "How do I submit this invoice?",
    });
    expect(result).toMatchObject({
      disposition: "rewrite",
      text: "Which insurer should receive the invoice?",
    });
  });
  it("an attributed source quote is never mistaken for the assistant's medical disclaimer", async () => {
    generate
      .mockResolvedValueOnce({ output: { medicalJudgmentRequested: false } })
      .mockResolvedValueOnce({ output: allowed });
    const text =
      'The office wrote: "I cannot provide medical advice". Please ask that office about the invoice.';
    expect(
      await createResponseGuard(config)({
        ...input,
        text,
        userText: "Read the office reply about my invoice.",
      }),
    ).toMatchObject({ disposition: "allow", text });
  });
  it("medical requests receive the fixed handoff independently of a misleading administrative candidate", async () => {
    generate.mockResolvedValueOnce({ output: { medicalJudgmentRequested: true } });
    expect(
      await createResponseGuard(config)({ ...input, userText: "Should I change my dose?" }),
    ).toMatchObject({
      disposition: "handoff",
      text: guardCopy.en.handoff,
    });
  });
  it("a generated repair cannot bypass the medical rules", async () => {
    generate
      .mockResolvedValueOnce({ output: { medicalJudgmentRequested: false } })
      .mockResolvedValueOnce({ output: incomplete })
      .mockResolvedValueOnce({ text: "Take 20 mg daily." });
    expect(await createResponseGuard(config)(input)).toMatchObject({
      disposition: "unknown",
      reason: "rule",
      text: guardCopy.en.unknown,
    });
  });
  it("an unavailable initial classifier fails closed without a repair", async () => {
    generate.mockRejectedValueOnce(new Error("synthetic private provider error"));
    const result = await createResponseGuard(config)(input);
    expect(result).toMatchObject({ disposition: "handoff", reason: "unavailable" });
    expect(result.text).not.toContain("private");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("an unavailable repair retains the safe administrative fallback", async () => {
    generate
      .mockResolvedValueOnce({ output: { medicalJudgmentRequested: false } })
      .mockResolvedValueOnce({ output: incomplete })
      .mockRejectedValueOnce(new Error("synthetic private provider error"));
    expect(await createResponseGuard(config)(input)).toMatchObject({
      disposition: "unknown",
      text: guardCopy.en.unknown,
    });
  });
  it("cancellation during repair propagates without emitting a fallback", async () => {
    const controller = new AbortController();
    generate
      .mockResolvedValueOnce({ output: { medicalJudgmentRequested: false } })
      .mockResolvedValueOnce({ output: incomplete })
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new Error("synthetic cancelled repair");
      });
    await expect(
      createResponseGuard(config)({ ...input, signal: controller.signal }),
    ).rejects.toThrow();
  });
});
