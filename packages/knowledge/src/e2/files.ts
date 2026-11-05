import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { isMissing } from "../loader/files.ts";

const execute = promisify(execFile);

export async function repositoryFiles(root: string): Promise<string[]> {
  try {
    await lstat(join(root, ".git"));
    const { stdout } = await execute("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return [...new Set(stdout.split("\0").filter(Boolean))].filter(isPublicPath).sort();
  } catch (error) {
    if (!isMissing(error)) throw error;
    // Source archives and hosts without Git still scan non-ignored public sources.
    return archiveFiles(root);
  }
}

function isPublicPath(file: string): boolean {
  return file.split("/").every((part) => !part.startsWith(".env") || part === ".env.example");
}

// Tracked links remain errors; archive traversal excludes links before this check.
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

const archiveIgnored = new Set([
  "node_modules",
  ".next",
  ".git",
  ".build",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".swiftpm",
  "DerivedData",
  ".orchestration",
  "test-results",
  "playwright-report",
  "blob-report",
]);
interface IgnoreScope {
  directory: string;
  rules: Ignore;
}

async function ignoreScopes(
  root: string,
  directory: string,
  inherited: readonly IgnoreScope[],
): Promise<readonly IgnoreScope[]> {
  const path = join(root, directory, ".gitignore");
  try {
    if (!(await lstat(path)).isFile()) return inherited;
    return [...inherited, { directory, rules: ignore().add(await readFile(path, "utf8")) }];
  } catch (error) {
    if (isMissing(error)) return inherited;
    throw error;
  }
}

function isIgnored(file: string, scopes: readonly IgnoreScope[]): boolean {
  let ignored = false;
  for (const scope of scopes) {
    const relative = scope.directory ? file.slice(scope.directory.length + 1) : file;
    const result = scope.rules.test(relative);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

async function archiveFiles(
  root: string,
  directory = "",
  inherited: readonly IgnoreScope[] = [],
): Promise<string[]> {
  const scopes = await ignoreScopes(root, directory, inherited);
  const files: string[] = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const file = directory ? `${directory}/${entry.name}` : entry.name;
    if (
      entry.isSymbolicLink() ||
      archiveIgnored.has(entry.name) ||
      (!directory && entry.name === "data") ||
      !isPublicPath(file) ||
      isIgnored(entry.isDirectory() ? `${file}/` : file, scopes)
    )
      continue;
    if (entry.isDirectory()) files.push(...(await archiveFiles(root, file, scopes)));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}
