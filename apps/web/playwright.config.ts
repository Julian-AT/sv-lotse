import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT } from "./e2e/config.ts";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
const wsEndpoint = process.env.PW_TEST_CONNECT_WS_ENDPOINT;
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/demo/**",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  use: {
    baseURL: E2E_BASE_URL,
    trace: "off",
    ...(wsEndpoint
      ? {
          connectOptions: {
            wsEndpoint,
            exposeNetwork: process.env.PW_TEST_CONNECT_EXPOSE_NETWORK ?? "<loopback>",
          },
        }
      : {}),
  },
  webServer: {
    command: "bun run start",
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    // Exercise the optional workspace URL's unset/default deployment path.
    env: { LOTSE_WORKSPACE_URL: "", PORT: String(E2E_PORT) },
  },
});
