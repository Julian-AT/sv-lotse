import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "./load-env.mjs";

loadLocalEnvironment();
const output = new URL("../.next/standalone/apps/web/", import.meta.url);
await mkdir(new URL(".next", output), { recursive: true });
await cp(new URL("../.next/static", import.meta.url), new URL(".next/static", output), {
  recursive: true,
});
process.env.HOSTNAME = "127.0.0.1";
process.chdir(fileURLToPath(output));
await import(new URL("server.js", output).href);
