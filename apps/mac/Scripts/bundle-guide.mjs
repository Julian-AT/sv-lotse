import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { build } from "../../../packages/guide/node_modules/esbuild/lib/main.js";
import { parse } from "../../../packages/knowledge/node_modules/yaml/dist/index.js";

const root = new URL("../../../", import.meta.url);
const resources = new URL(
  "apps/mac/Packages/LotseKit/Sources/LotseGuidedWindow/Resources/generated/",
  root,
);
await mkdir(resources, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { createGuide, toCapsulePage } from "./src/index.ts";',
    resolveDir: fileURLToPath(new URL("packages/guide/", root)),
    sourcefile: "mac-guide-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  globalName: "__lotseGuide",
  platform: "browser",
  target: "safari17",
  minify: true,
  write: false,
});
const maximumBundleBytes = 512 * 1024;
const source = bundle.outputFiles[0].contents;
if (source.byteLength > maximumBundleBytes) {
  throw new Error("Guide injection bundle exceeds 512 KiB");
}
// Native Foundation inflates this resource before creating the WKUserScript.
await writeFile(new URL("guide.deflate", resources), deflateRawSync(source));
await writeFile(
  new URL("guide-licenses.txt", resources),
  await readFile(new URL("packages/guide/node_modules/zod/LICENSE", root)),
);
const catalog = parse(await readFile(new URL("packages/knowledge/allowlist.yaml", root), "utf8"));
if (!Array.isArray(catalog.origins)) throw new Error("Invalid knowledge allowlist");
const origins = catalog.origins.map(({ origin }) => {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== origin) {
    throw new Error("Invalid knowledge origin");
  }
  return origin;
});
await writeFile(new URL("origins.json", resources), `${JSON.stringify(origins, null, 2)}\n`);
