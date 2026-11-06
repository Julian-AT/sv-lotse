import { z } from "zod";
import { CURSOR_CONFIG } from "./config.ts";

export const CursorPreferencesSchema = z.strictObject({
  cursorSize: z.number().min(16).max(64),
  cursorSpeed: z.number().min(0.5).max(2),
  reducedMotion: z.boolean(),
});
export type CursorPreferences = z.infer<typeof CursorPreferencesSchema>;

/** Host attributes affect presentation only; they never grant action permissions. */
export function readCursorPreferences(
  document: Document,
  overrides: Partial<CursorPreferences> = {},
): CursorPreferences {
  const data = document.documentElement.dataset;
  const result = CursorPreferencesSchema.safeParse({
    cursorSize: data.cursorSize ? Number(data.cursorSize) : CURSOR_CONFIG.size,
    cursorSpeed: data.cursorSpeed ? Number(data.cursorSpeed) : CURSOR_CONFIG.speed,
    reducedMotion: data.reducedMotion === "true",
    ...overrides,
  });
  const preferences = result.success
    ? result.data
    : {
        cursorSize: CURSOR_CONFIG.size,
        cursorSpeed: CURSOR_CONFIG.speed,
        reducedMotion: false,
      };
  return {
    ...preferences,
    reducedMotion:
      preferences.reducedMotion ||
      (document.defaultView?.matchMedia(CURSOR_CONFIG.reducedMotionQuery).matches ?? false),
  };
}
