import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const routes = [
  ["/src/", resolve(packageRoot, "src")],
  ["/data/", resolve(packageRoot, "data")],
  ["/test/", resolve(packageRoot, "test")],
  ["/protocol/", resolve(packageRoot, "../protocol/src")],
  ["/zod/", dirname(fileURLToPath(import.meta.resolve("zod")))],
] as const;
const importMap =
  '<script type="importmap">{"imports":{"@lotse/protocol":"/protocol/index.ts","zod":"/zod/index.js"}}</script>';

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1:4178").pathname;
    const route = routes.find(([prefix]) => pathname.startsWith(prefix));
    const root = route?.[1] ?? resolve(packageRoot, "test/fixtures");
    const relative = route ? pathname.slice(route[0].length) : pathname.slice(1);
    const file = resolve(root, decodeURIComponent(relative));
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    let content = await readFile(file, "utf8");
    let mime = "text/javascript";
    if (file.endsWith(".ts")) content = stripTypeScriptTypes(content);
    else if (file.endsWith(".html")) {
      content = content.replace("<head>", `<head>${importMap}`);
      mime = "text/html";
    } else if (file.endsWith(".json")) mime = "application/json";
    response
      .writeHead(200, { "Content-Type": `${mime}; charset=utf-8`, "Cache-Control": "no-store" })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4178, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close());
