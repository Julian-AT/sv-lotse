import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { URL as FileURL, fileURLToPath, pathToFileURL } from "node:url";

/** Package runners and the standalone web host retain the monorepo-relative data layout. */
export function knowledgeAssetUrl(relativePath: string): URL {
  const packaged = resolve(process.cwd(), "../../packages/knowledge");
  const root = existsSync(packaged)
    ? packaged
    : fileURLToPath(new FileURL("../../../knowledge/", import.meta.url));
  return pathToFileURL(resolve(root, relativePath));
}
