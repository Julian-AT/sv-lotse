import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
// Do not follow links out of the repository or into generated/build trees.
export async function sourceFiles(
  root: string,
  matches: ReadonlySet<string> | ((fileName: string) => boolean),
  ignored: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`${path}: $: symbolic links are not supported`);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path, matches, ignored)));
    else if (typeof matches === "function" ? matches(entry.name) : matches.has(extname(entry.name)))
      files.push(path);
  }
  return files;
}
