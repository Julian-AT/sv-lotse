import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.db.test.ts", "test/health.test.ts"],
        },
      },
      {
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
