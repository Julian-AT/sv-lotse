import { randomUUID } from "node:crypto";
import type { SpeechSegment } from "@lotse/protocol";
import { describe, expect, it } from "vitest";
import { createLotseAgent } from "../../src/agent/index.ts";
import { communicationInstructions } from "../../src/language/copy.ts";
import {
  detectCommunicationPreferences,
  LanguageDetectionSchema,
  preferencePatch,
  replySettings,
} from "../../src/language/detect.ts";
import { createSpeechSegmenter } from "../../src/language/segments.ts";
import {
  DEFAULT_PROFILE_SETTINGS,
  ProfileSettingsPatchSchema,
  settingsFromProfile,
} from "../../src/language/settings.ts";
import { config, forcedModel } from "../runtime/helpers.ts";

const noRequests = {
  detectedLanguage: null,
  requestedLanguage: null,
  simpleLanguage: null,
  register: null,
  detailLevel: null,
} as const;

describe("FR-L1–L3 communication preferences", () => {
  it("FR-L1 follows detected English and an explicit German request takes precedence", () => {
    expect(
      replySettings(DEFAULT_PROFILE_SETTINGS, { ...noRequests, detectedLanguage: "en" }).language,
    ).toBe("en");
    expect(
      replySettings(DEFAULT_PROFILE_SETTINGS, {
        ...noRequests,
        detectedLanguage: "en",
        requestedLanguage: "de",
      }).language,
    ).toBe("de");
    expect(preferencePatch({ ...noRequests, detectedLanguage: "en" })).toEqual({ language: "en" });
    expect(preferencePatch(noRequests)).toBeUndefined();
  });
  it("NFR-7 keeps ambiguous and unsupported languages on the profile's enabled language", () => {
    const profile = { ...DEFAULT_PROFILE_SETTINGS, language: "en" as const };
    for (const detectedLanguage of [null, "unsupported"] as const)
      expect(replySettings(profile, { ...noRequests, detectedLanguage }).language).toBe("en");
    expect(
      LanguageDetectionSchema.safeParse({ ...noRequests, detectedLanguage: "fr" }).success,
    ).toBe(false);
  });
  it("FR-L2 and FR-L3 preserve explicit off, informal address and brief answers", () => {
    const request = {
      ...noRequests,
      simpleLanguage: false,
      register: "informal" as const,
      detailLevel: "brief" as const,
    };
    expect(preferencePatch(request)).toEqual({
      simpleLanguage: false,
      register: "informal",
      detailLevel: "brief",
    });
    expect(
      replySettings({ ...DEFAULT_PROFILE_SETTINGS, simpleLanguage: true }, request),
    ).toMatchObject(preferencePatch(request) ?? {});
    expect(
      settingsFromProfile({ language: "de-AT-simple", register: "informal", detailLevel: "brief" }),
    ).toMatchObject({
      language: "de",
      simpleLanguage: true,
      register: "informal",
      detailLevel: "brief",
    });
    expect(
      settingsFromProfile({ language: "en-simple", register: "formal", detailLevel: "detailed" }),
    ).toMatchObject({ language: "en", simpleLanguage: true });
  });
  it("accepts only communication settings, never identity or autonomy changes", () => {
    for (const patch of [
      {},
      { userId: randomUUID() },
      { autonomyLevel: "L3" },
      { language: "fr" },
      { simpleLanguage: "true" },
    ])
      expect(ProfileSettingsPatchSchema.safeParse(patch).success).toBe(false);
  });
  it("FR-L1 validates structured language detection through the real SDK", async () => {
    expect(await detectCommunicationPreferences("Bitte helfen Sie mir.", forcedModel())).toEqual({
      ...noRequests,
      detectedLanguage: "de",
    });
  });
  it("FR-L2 applies A2, address and detail to the model without relaxing the medical boundary", async () => {
    const settings = {
      ...DEFAULT_PROFILE_SETTINGS,
      simpleLanguage: true,
      register: "informal" as const,
      detailLevel: "detailed" as const,
    };
    const model = forcedModel();
    const agent = createLotseAgent({
      config,
      model,
      dependencies: { allowStubs: false },
      context: {
        caseId: randomUUID(),
        subjectId: randomUUID(),
        actorId: randomUUID(),
        userId: randomUUID(),
        sessionId: randomUUID(),
        actorRole: "subject",
        autonomyLevel: "L1",
        shareScope: {},
        sentenceIndex: 0,
        profileSettings: settings,
        responsePreferences: { ...DEFAULT_PROFILE_SETTINGS, language: "en" },
      },
    });
    const result = await agent.stream({ prompt: "Bitte helfen." });
    await result.consumeStream();
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain("CEFR A2");
    expect(prompt).toContain("du/dir/dein");
    expect(prompt).toContain("detailed administrative explanations");
    expect(prompt).toContain("Never derive or name diagnoses");
    expect(prompt).not.toContain("Reply in English.");
    expect(communicationInstructions(settings)).toContain("Keep official German form fields");
    expect(communicationInstructions(settings)).toContain("preserve the exact source quote");
  });
  it.each([
    { savedPreferences: true, administrativeOnly: true },
    { savedPreferences: true, administrativeOnly: false },
    { savedPreferences: false, administrativeOnly: true },
    { savedPreferences: false, administrativeOnly: false },
  ])(
    "preserves response preferences and SR-1 scope independently: %j",
    async ({ savedPreferences, administrativeOnly }) => {
      const model = forcedModel();
      const agent = createLotseAgent({
        config,
        model,
        administrativeOnly,
        dependencies: { allowStubs: false },
        context: {
          caseId: randomUUID(),
          subjectId: randomUUID(),
          actorId: randomUUID(),
          userId: randomUUID(),
          sessionId: randomUUID(),
          actorRole: "subject",
          autonomyLevel: "L1",
          shareScope: {},
          sentenceIndex: 0,
          ...(savedPreferences
            ? { responsePreferences: { ...DEFAULT_PROFILE_SETTINGS, language: "en" as const } }
            : {}),
        },
      });
      const result = await agent.stream({ prompt: "Please help with the administrative task." });
      await result.consumeStream();
      const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
      expect(prompt).toContain(
        savedPreferences ? "Reply in English." : "Reply language: German (Austria).",
      );
      expect(prompt).toContain("Never derive or name diagnoses");
      expect(prompt.includes("A previous SR-1 notice set scopeAfter=administrative_only")).toBe(
        administrativeOnly,
      );
    },
  );
});

describe("FR-L1 and FR-L2 speech segments", () => {
  it.each(["de", "en"] as const)(
    "keeps captions and speech identical in %s across fragmented input",
    (language) => {
      const emitted: SpeechSegment[] = [];
      const id = randomUUID();
      const segmenter = createSpeechSegmenter(
        id,
        { ...DEFAULT_PROFILE_SETTINGS, language, simpleLanguage: true, register: "informal" },
        (segment) => emitted.push(segment),
      );
      const text =
        language === "de"
          ? "Öffne das Formular. Trage 12,50 Euro ein. Prüfe den Entwurf."
          : "Open the form. Enter 12.50 euros. Review the draft.";
      for (const character of text) segmenter.push(character);
      segmenter.flush();
      segmenter.flush();
      expect(emitted.map((segment) => segment.text).join(" ")).toBe(text);
      expect(emitted.map((segment) => segment.index)).toEqual([0, 1, 2]);
      expect(
        emitted.every(
          (segment) =>
            segment.turnId === id && segment.language === (language === "de" ? "de-AT" : "en"),
        ),
      ).toBe(true);
    },
  );
  it("emits a complete sentence before text-end and preserves verbatim wording", () => {
    const emitted: SpeechSegment[] = [];
    const segmenter = createSpeechSegmenter(
      randomUUID(),
      DEFAULT_PROFILE_SETTINGS,
      (segment) => emitted.push(segment),
      4,
    );
    segmenter.push("Bitte prüfen Sie den Entwurf. Danach");
    expect(emitted[0]).toMatchObject({ index: 4, text: "Bitte prüfen Sie den Entwurf." });
    segmenter.push(" geht es weiter.");
    segmenter.flush();
    expect(emitted[1]).toMatchObject({ index: 5, text: "Danach geht es weiter." });
  });
});
