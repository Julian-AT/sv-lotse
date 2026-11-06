import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/inject.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  write: false,
});
const output = result.outputFiles[0];
if (!output || output.contents.byteLength > 512 * 1024) {
  throw new Error("Guide bundle exceeds its 512 KiB budget");
}
const directory = new URL("../dist-bundle/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("guide.iife.js", directory), output.contents);
console.info(`Guide IIFE: ${output.contents.byteLength} bytes`);
