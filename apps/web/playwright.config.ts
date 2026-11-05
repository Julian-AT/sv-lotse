import { defineConfig } from "@playwright/test";
import { loadLocalEnvironment } from "./scripts/load-env.mjs";

loadLocalEnvironment();
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  use: { baseURL: "http://localhost:3000", trace: "off" },
  webServer: {
    command: "bun run start",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: false,
    timeout: 60000,
    // Exercise the optional workspace URL's unset/default deployment path.
    env: { LOTSE_WORKSPACE_URL: "" },
  },
});
