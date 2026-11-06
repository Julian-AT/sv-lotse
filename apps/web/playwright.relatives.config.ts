import { defineConfig } from "@playwright/test";
import { E2E_APP_USER_AGENT } from "./e2e/config.ts";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
const baseURL = "http://localhost:3021";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "relatives.spec.ts",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  use: {
    userAgent: E2E_APP_USER_AGENT,
    baseURL,
    trace: "off",
    actionTimeout: 10000,
    navigationTimeout: 10000,
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
    command:
      process.env.RELATIVES_E2E_DEV === "1" ? "bun run dev --webpack --port 3021" : "bun run start",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: process.env.RELATIVES_E2E_DEV === "1" ? 120000 : 60000,
    env: { PORT: "3021", LOTSE_WORKSPACE_URL: "" },
  },
});
