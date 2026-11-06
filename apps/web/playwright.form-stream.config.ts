import { defineConfig } from "@playwright/test";
import { E2E_APP_USER_AGENT } from "./e2e/config.ts";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
const baseURL = "http://localhost:3063";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "form-stream.spec.ts",
  workers: 1,
  forbidOnly: true,
  timeout: 150000,
  expect: { timeout: 45000 },
  use: {
    userAgent: E2E_APP_USER_AGENT,
    baseURL,
    trace: "off",
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
    command: "bun run dev --webpack --port 3063",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180000,
    env: { LOTSE_WORKSPACE_URL: baseURL, WATCHPACK_POLLING: "true" },
  },
});
