import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = {
  alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
};

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.db.test.ts", "test/health.test.ts"],
        },
      },
      {
        resolve,
        test: {
          name: "services",
          include: ["test/**/*.db.test.ts", "test/health.test.ts"],
          hookTimeout: 30000,
          testTimeout: 15000,
        },
      },
    ],
  },
});
