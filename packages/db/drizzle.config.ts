import { defineConfig } from "drizzle-kit";

// Named exports instead of a default export; Drizzle Kit reads either form.
export const { dialect, schema, out, casing } = defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
});
