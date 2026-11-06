export const GUIDANCE_PART_EVENT = "lotse:guidance-part";
export const GUIDANCE_TRANSCRIPT_EVENT = "lotse:transcript";
export const TURN_URL = "/api/turn";
export const APP_VERSION = "0.1.0";
/** Pages that host their own conversation; the layout adds no second one there (one per screen). */
export const PAGE_CONVERSATION_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/workspace\/?$/,
  /^\/cases\/[^/]+\/?$/,
];
