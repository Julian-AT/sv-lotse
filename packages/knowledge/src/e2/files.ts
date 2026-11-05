import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isMissing } from "../loader/files.ts";

const execute = promisify(execFile);

export async function repositoryFiles(root: string): Promise<string[]> {
  const { stdout } = await execute(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return [...new Set(stdout.split("\0").filter(Boolean))]
    .filter((file) =>
      file.split("/").every((part) => !part.startsWith(".env") || part === ".env.example"),
    )
    .sort();
}

// Keep the filesystem walker's refusal to follow links, including parent directories.
export async function isRegularSource(root: string, file: string): Promise<boolean> {
  let path = root;
  try {
    const parts = file.split("/");
    for (const [index, part] of parts.entries()) {
      path = join(path, part);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new Error(`${path}: $: symbolic links are not supported`);
      if (index === parts.length - 1) return entry.isFile();
      if (!entry.isDirectory()) return false;
    }
    return false;
  } catch (error) {
    // Deleted tracked files are still listed by Git, but have no source to scan.
    if (isMissing(error)) return false;
    throw error;
  }
}
