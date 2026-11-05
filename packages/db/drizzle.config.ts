import { defineConfig } from "drizzle-kit";

// Drizzle Kit accepts the module's named configuration properties.
export const { dialect, schema, out, casing } = defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
});
