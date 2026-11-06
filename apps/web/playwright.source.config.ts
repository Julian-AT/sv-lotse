import { defineConfig } from "@playwright/test";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
export default defineConfig({
  testDir: "./e2e",
  testMatch: "source-highlight.spec.ts",
  workers: 1,
  use: {
    baseURL: process.env.SOURCE_TEST_URL ?? "http://localhost:4343",
    ...(process.env.PW_TEST_CONNECT_WS_ENDPOINT
      ? {
          connectOptions: {
            wsEndpoint: process.env.PW_TEST_CONNECT_WS_ENDPOINT,
            exposeNetwork: "<loopback>",
          },
        }
      : {}),
  },
});
