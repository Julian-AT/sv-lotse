import { defineConfig } from "@playwright/test";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
const baseURL = "http://localhost:3016";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "workspace.spec.ts",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  use: {
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
    command: "bun run start",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: "3016", LOTSE_WORKSPACE_URL: "" },
  },
});
