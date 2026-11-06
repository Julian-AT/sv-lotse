import { copyFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
await copyFile(
  new URL("packages/knowledge/guards/capture-exclusions.json", root),
  new URL("apps/mac/Packages/LotseKit/Sources/LotseCore/Resources/capture-exclusions.json", root),
);
