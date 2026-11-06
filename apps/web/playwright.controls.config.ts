import { defineConfig } from "@playwright/test";
import { z } from "zod";
import { E2E_APP_USER_AGENT } from "./e2e/config.ts";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
const port = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65534)
  .default(3043)
  .parse(process.env.LOTSE_CONTROLS_PORT);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e/controls",
  globalSetup: "./e2e/controls/warmup.ts",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "test-results/controls",
  use: {
    userAgent: E2E_APP_USER_AGENT,
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    ...(process.env.PW_TEST_CONNECT_WS_ENDPOINT
      ? {
          connectOptions: {
            wsEndpoint: process.env.PW_TEST_CONNECT_WS_ENDPOINT,
            exposeNetwork: "<loopback>",
          },
        }
      : {}),
  },
  webServer: {
    command: `bun run dev -- --webpack --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      LOTSE_WORKSPACE_URL: "",
      WATCHPACK_POLLING: "true",
      LOTSE_NEXT_DIST_DIR: ".next/controls",
    },
  },
});
