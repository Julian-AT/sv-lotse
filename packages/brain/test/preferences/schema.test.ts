import { describe, expect, it } from "vitest";
import { responsePreferenceInstructions } from "../../src/preferences/prompt.ts";
import {
  DEFAULT_PREFERENCES,
  preferencesPatchSchema,
  preferencesSchema,
  profilePreferences,
} from "../../src/preferences/schema.ts";

describe("FR-L4, FR-A1 preferences", () => {
  it("defaults to L3 without analytics consent and requires an explicit patch to change either", () => {
    expect(profilePreferences()).toMatchObject({
      autonomyLevel: "L3",
      analyticsConsent: false,
      onboardingCompleted: false,
    });
    expect(preferencesPatchSchema.parse({ language: "en" })).toEqual({ language: "en" });
    expect(preferencesPatchSchema.parse({ analyticsConsent: false })).toEqual({
      analyticsConsent: false,
    });
  });
  it("rejects identity, unsupported languages, levels and malformed accessibility values", () => {
    for (const input of [
      { userId: "foreign" },
      { language: "tr" },
      { autonomyLevel: "L4" },
      { analyticsConsent: "true" },
      { speechRate: 2 },
      { voiceURI: "a".repeat(257) },
    ])
      expect(preferencesPatchSchema.safeParse(input).success).toBe(false);
  });
  it("keeps existing profile fields while defaulting new presentation preferences", () => {
    expect(
      profilePreferences({
        language: "en-GB",
        register: "informal",
        detailLevel: "detailed",
        autonomyLevel: "L2",
        preferences: {},
      }),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      language: "en",
      register: "informal",
      detailLevel: "detailed",
      autonomyLevel: "L2",
    });
  });
  it("FR-L2 and FR-L3 drive response instructions without granting tools", () => {
    const instructions = responsePreferenceInstructions({
      language: "en",
      simpleLanguage: true,
      register: "informal",
      detailLevel: "brief",
    });
    expect(instructions).toContain("Reply in English");
    expect(instructions).toContain("CEFR B1");
    expect(instructions).toContain("informal address");
    expect(instructions).toContain("brief");
    expect(instructions).toContain("do not change safety rules or tool permissions");
    expect(preferencesSchema.parse(DEFAULT_PREFERENCES).autonomyLevel).toBe("L3");
  });
  it("reads legacy simple-language profiles and lets saved presentation settings override them", () => {
    const profile = {
      language: "en-simple",
      register: "informal",
      detailLevel: "brief",
      autonomyLevel: "L2",
      preferences: {},
    };
    expect(profilePreferences(profile)).toMatchObject({ language: "en", simpleLanguage: true });
    expect(
      profilePreferences({ ...profile, preferences: { simpleLanguage: false } }),
    ).toMatchObject({
      language: "en",
      simpleLanguage: false,
    });
  });
});
