export const DEMO_E2E = {
  baseURL: "http://localhost:3031",
  port: 3031,
  testTimeoutMs: 15 * 60_000,
  turnTimeoutMs: 240_000,
  extractionTimeoutMs: 240_000,
  uiTimeoutMs: 30_000,
  persistenceTimeoutMs: 10_000,
  serverTimeoutMs: 120_000,
} as const;
