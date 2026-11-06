// @vitest-environment jsdom
import { preferencesPatchSchema, profilePreferences } from "@lotse/brain/preferences/schema";
import { readCursorPreferences } from "@lotse/guide";
import { afterEach, expect, test, vi } from "vitest";
import { typeFieldValue } from "../src/features/form-viewer/typing.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-cursor-size");
  document.documentElement.removeAttribute("data-cursor-speed");
  document.documentElement.removeAttribute("data-reduced-motion");
});

test("legacy profiles gain cursor defaults and cursor bounds reject invalid preferences", () => {
  expect(
    profilePreferences({
      language: "de",
      register: "formal",
      detailLevel: "standard",
      autonomyLevel: "L1",
      preferences: { highContrast: true },
    }),
  ).toMatchObject({
    cursorSize: 24,
    cursorSpeed: 1,
    highContrast: true,
  });
  for (const patch of [
    { cursorSize: 0 },
    { cursorSize: 65 },
    { cursorSpeed: 0 },
    { cursorSpeed: 3 },
    { cursorSize: "40" },
  ])
    expect(preferencesPatchSchema.safeParse(patch).success).toBe(false);
});

test("the in-page guide reads saved size and speed on each action and honours either motion preference", () => {
  let systemReduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: systemReduced }));
  document.documentElement.dataset.cursorSize = "40";
  document.documentElement.dataset.cursorSpeed = "0.5";
  expect(readCursorPreferences(document)).toEqual({
    cursorSize: 40,
    cursorSpeed: 0.5,
    reducedMotion: false,
  });
  document.documentElement.dataset.cursorSize = "64";
  document.documentElement.dataset.reducedMotion = "true";
  expect(readCursorPreferences(document)).toMatchObject({ cursorSize: 64, reducedMotion: true });
  document.documentElement.dataset.reducedMotion = "false";
  systemReduced = true;
  expect(
    readCursorPreferences(document, { cursorSize: 40, cursorSpeed: 0.5, reducedMotion: false }),
  ).toMatchObject({ reducedMotion: true });
});

test("form typing speed scales keystroke pacing while reduced motion shows the complete value immediately", async () => {
  vi.useFakeTimers();
  const payload = {
    value: "AB",
    pace: 40,
    provenance: { source: { kind: "statement" as const, quote: "AB" } },
  };
  const values: string[] = [];
  const typing = typeFieldValue(payload, {
    signal: new AbortController().signal,
    reducedMotion: false,
    paceMultiplier: 2,
    onValue: (value) => values.push(value),
  });
  await vi.advanceTimersByTimeAsync(79);
  expect(values).toEqual([""]);
  await vi.advanceTimersByTimeAsync(1);
  expect(values).toEqual(["", "A"]);
  await vi.advanceTimersByTimeAsync(80);
  await typing;
  expect(values).toEqual(["", "A", "AB"]);
  const immediate: string[] = [];
  await typeFieldValue(payload, {
    signal: new AbortController().signal,
    reducedMotion: true,
    paceMultiplier: 2,
    onValue: (value) => immediate.push(value),
  });
  expect(immediate).toEqual(["", "AB"]);
  expect(vi.getTimerCount()).toBe(0);
});
