import type { PlaywrightTestConfig } from "@playwright/test";

const configuration = {
  testDir: "./test/e2e",
  fullyParallel: true,
  workers: 2,
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1000, height: 800 },
  },
  webServer: {
    command: "node --experimental-strip-types test/server.ts",
    url: "http://127.0.0.1:4178/plain.html",
    reuseExistingServer: false,
  },
} satisfies PlaywrightTestConfig;

// Playwright accepts the module namespace as its configuration object.
export const { testDir, fullyParallel, workers, use, webServer } = configuration;
