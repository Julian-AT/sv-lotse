import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// test/runtime/route.live.test.ts imports the web route, whose modules use the web app's @ alias.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../apps/web/src", import.meta.url)) },
  },
});
