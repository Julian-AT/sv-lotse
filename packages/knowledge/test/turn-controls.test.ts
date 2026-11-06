import { describe, expect, it } from "vitest";
import { detectTurnControl, turnControlPolicy } from "../src/turn-controls.ts";

describe("FR-A1 / FR-R5 deterministic bilingual controls", () => {
  it.each([
    ["zeig es mir nur", "L1"],
    ["Just show me", "L1"],
    ["bereite alles vor", "L2"],
    ["Prepare everything", "L2"],
    ["mach das für mich", "L3"],
    ["Do it for me", "L3"],
  ])("FR-A1 maps %s to %s without a classifier", (text, level) => {
    expect(detectTurnControl(text)).toEqual({ kind: "autonomy", level });
  });
  it.each(["Pause", "Teilen stoppen", "Stop sharing"])("FR-R5 recognizes %s", (text) => {
    expect(detectTurnControl(text)).toEqual({ kind: "pause" });
  });
  it("recognizes every sourced command with case, whitespace and speech punctuation", () => {
    for (const rule of turnControlPolicy.rules) {
      for (const phrase of rule.phrases) {
        const expected =
          rule.kind === "autonomy" ? { kind: rule.kind, level: rule.level } : { kind: rule.kind };
        expect(detectTurnControl(`  ${phrase.toUpperCase().replaceAll(" ", "  ")}!  `)).toEqual(
          expected,
        );
      }
    }
  });
  it("does not treat negated, quoted, embedded, or ambiguous commands as authorization", () => {
    for (const text of [
      "Nicht mach das für mich",
      'Translate "Do it for me"',
      "Do it for me and just show me",
      "The page says Pause",
      '"Pause"',
      "Do not stop sharing",
      "Bereite alles vor, aber nicht für mich",
      "",
    ]) {
      expect(detectTurnControl(text)).toBeUndefined();
    }
  });
});
