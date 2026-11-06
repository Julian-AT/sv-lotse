import { parseBrainConfig } from "@lotse/brain/config";
import { defineConfig } from "@playwright/test";
import { E2E_APP_USER_AGENT } from "./e2e/config.ts";
import { DEMO_E2E } from "./e2e/demo/config.ts";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
if (process.env.RUN_LIVE !== "1") throw new Error("DEMO_REQUIRES_RUN_LIVE");
if (!process.env.OPENAI_API_KEY) throw new Error("DEMO_REQUIRES_OPENAI_API_KEY");
if (parseBrainConfig().allowStubs) throw new Error("DEMO_REQUIRES_REAL_SERVICES");
export default defineConfig({
  testDir: "./e2e/demo",
  testMatch: "flow.spec.ts",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: DEMO_E2E.testTimeoutMs,
  expect: { timeout: DEMO_E2E.uiTimeoutMs },
  use: {
    userAgent: E2E_APP_USER_AGENT,
    baseURL: DEMO_E2E.baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    ...(process.env.PW_TEST_CONNECT_WS_ENDPOINT
      ? {
          connectOptions: {
            wsEndpoint: process.env.PW_TEST_CONNECT_WS_ENDPOINT,
            exposeNetwork: process.env.PW_TEST_CONNECT_EXPOSE_NETWORK ?? "<loopback>",
          },
        }
      : {}),
  },
  webServer: {
    command: `bun run dev --webpack --port ${DEMO_E2E.port}`,
    url: `${DEMO_E2E.baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: DEMO_E2E.serverTimeoutMs,
    env: {
      WATCHPACK_POLLING: "true",
      PORT: String(DEMO_E2E.port),
      LOTSE_WORKSPACE_URL: DEMO_E2E.baseURL,
    },
  },
});
