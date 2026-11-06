export { communicationInstructions } from "./copy.ts";
export {
  detectCommunicationPreferences,
  LanguageDetectionSchema,
  preferencePatch,
  replySettings,
} from "./detect.ts";
export { createSpeechSegmenter } from "./segments.ts";
export type { ProfileSettings, ProfileSettingsPatch } from "./settings.ts";
export {
  DEFAULT_PROFILE_SETTINGS,
  ProfileSettingsPatchSchema,
  ProfileSettingsSchema,
  readProfileSettings,
  settingsFromProfile,
  updateProfileSettings,
} from "./settings.ts";
