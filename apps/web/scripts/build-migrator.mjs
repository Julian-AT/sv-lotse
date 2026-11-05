import { cp } from "node:fs/promises";
import { build } from "bun";

// Preserve the @lotse/db migrator's relative ../../drizzle path after bundling.
const result = await build({
  entrypoints: ["scripts/migrate.ts"],
  outdir: ".next/migrator/packages/db/src/db",
  naming: "[name].mjs",
  target: "node",
  format: "esm",
});
if (!result.success) throw new Error("Migrator build failed");
await cp("../../packages/db/drizzle", ".next/migrator/packages/db/drizzle", {
  recursive: true,
});
