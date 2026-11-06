export const BOOKING_TYPE_PACE_MS = 40;

export const PORTAL_CONFIG = {
  paceMs: 65,
  maxFields: 100,
  maxValueLength: 10000,
  maxHandles: 2000,
} as const;

export const CURSOR_CONFIG = {
  size: 24,
  speed: 1,
  flightDurationMs: 180,
  reducedMotionQuery: "(prefers-reduced-motion: reduce)",
} as const;
