export const JOB_POLL_INTERVAL_MS = 2_000;

export const SETTINGS_CONFIG = {
  healthUrl: "/api/health/details",
  preferencesEvent: "lotse:preferences-saved",
  preferencesUrl: "/api/preferences",
  sessionUrl: "/api/session",
  exportUrl: "/api/export",
  deleteUrl: "/api/account",
  casesUrl: "/api/cases",
  invitesUrl: "/api/relatives/invites",
  helperSessionsUrl: "/api/relatives/sessions",
  approveHelperUrl: "/api/relatives/session",
  inviteLifetimeMs: 15 * 60 * 1000,
  healthTimeoutMs: 5000,
  healthPollMs: 60000,
  helperPollMs: 10000,
  openaiModelsUrl: "https://api.openai.com/v1/models",
  elevenlabsVoicesUrl: "https://api.elevenlabs.io/v1/voices",
  downloadFilename: "lotse-data.zip",
} as const;

export const ONBOARDING_CONFIG = {
  typingPaceMs: 65,
} as const;

export const SESSION_RESET_EVENT = "lotse:session-reset";

/** The chat is served only to the SV KI-Lotse Mac app; helper pages and the API stay public. */
export const NATIVE_APP_CONFIG = {
  /** Appended to the user agent by the Mac workspace web view (applicationNameForUserAgent). */
  userAgentToken: "SVKILotseMac/",
  embeddedPrefix: "/workspace",
} as const;
