import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Knowledge } from "../loader/index.ts";
import { type ScanConfig, scanConfig, scanRoots, stubFlag } from "./config.ts";
import { isRegularSource, repositoryFiles } from "./files.ts";
import { codeTokens } from "./tokens.ts";

export interface ScanFinding {
  file: string;
  line: number;
  value: string;
  rule: "catalog-id" | "stub-flag" | "dependency-direction";
}
const scriptExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const stubExtensions = new Set([
  ...scriptExtensions,
  ".swift",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".html",
  ".css",
  ".xml",
  ".plist",
  ".xcconfig",
  ".conf",
  "",
]);
const ignored = new Set([
  "node_modules",
  ".git",
  ".build",
  ".next",
  "build",
  "dist",
  "coverage",
  "DerivedData",
  "generated",
  ".orchestration",
  ".turbo",
  ".cache",
  ".swiftpm",
]);
// Generated protocol sources are still release sources and must not enable stubs.
const stubIgnored = new Set([...ignored].filter((directory) => directory !== "generated"));
function finding(
  file: string,
  source: string,
  offset: number,
  value: string,
  rule: ScanFinding["rule"],
): ScanFinding {
  return { file, line: source.slice(0, offset).split("\n").length, value, rule };
}
function catalogIds(knowledge: Knowledge): Set<string> {
  return new Set([
    ...[
      knowledge.catalog,
      knowledge.processes,
      knowledge.offices,
      knowledge.facilities,
      knowledge.forms,
    ].flatMap(Object.keys),
    ...Object.values(knowledge.catalog).flatMap((benefit) => benefit.life_situations),
  ]);
}
export async function brainKnowledgeImports(root: string): Promise<ScanFinding[]> {
  return scanBrainKnowledgeImports(root, await repositoryFiles(root));
}
async function scanBrainKnowledgeImports(
  root: string,
  files: readonly string[],
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  for (const file of files) {
    if (
      !file.startsWith("packages/brain/") ||
      !scriptExtensions.has(extname(file)) ||
      file.split("/").some((part) => ignored.has(part)) ||
      !(await isRegularSource(root, file))
    )
      continue;
    const path = join(root, file);
    const source = await readFile(path, "utf8");
    for (const token of codeTokens(source, false, path))
      if (token.value === "@lotse/knowledge" || token.value.startsWith("@lotse/knowledge/"))
        findings.push(finding(file, source, token.offset, token.value, "dependency-direction"));
  }
  return findings;
}
export async function scanRepository(
  root: string,
  knowledge: Knowledge,
  config: ScanConfig = scanConfig,
): Promise<ScanFinding[]> {
  const files = await repositoryFiles(root);
  const ids = catalogIds(knowledge);
  const templateIds = new Set(
    Object.values(knowledge.forms).map((form) => form.template_id.toLowerCase()),
  );
  const findings: ScanFinding[] = [];
  for (const directory of scanRoots) {
    const extensions = directory === "apps/mac" ? new Set([".swift"]) : scriptExtensions;
    for (const file of files) {
      if (
        !file.startsWith(`${directory}/`) ||
        !extensions.has(extname(file)) ||
        file.split("/").some((part) => ignored.has(part)) ||
        !(await isRegularSource(root, file))
      )
        continue;
      const path = join(root, file);
      const source = await readFile(path, "utf8");
      for (const token of codeTokens(source, path.endsWith(".swift"), path)) {
        for (const value of new Set([token.value, ...token.value.split(/[^A-Za-z0-9_.-]+/)])) {
          if (ids.has(value) || templateIds.has(value.toLowerCase()))
            findings.push(finding(file, source, token.offset, value, "catalog-id"));
        }
      }
    }
  }
  // Stub configuration can make release code reachable from outside the clients.
  // Check all source/build files, including shell scripts and root build manifests.
  const isStubSource = (name: string) =>
    stubExtensions.has(extname(name)) || name === ".env.example" || name.startsWith("Dockerfile.");
  for (const file of files) {
    // Original challenge files are input data, not source or build configuration.
    if (file.startsWith("data/") || config.allowedStubFiles.includes(file)) continue;
    if (
      !isStubSource(basename(file)) ||
      file.split("/").some((part) => stubIgnored.has(part)) ||
      !(await isRegularSource(root, file))
    )
      continue;
    const path = join(root, file);
    const source = await readFile(path, "utf8");
    if (scriptExtensions.has(extname(path)) || path.endsWith(".swift")) {
      for (const token of codeTokens(source, path.endsWith(".swift"), path)) {
        if (token.value.split(/[^A-Za-z0-9_$]+/).includes(stubFlag))
          findings.push(finding(file, source, token.offset, stubFlag, "stub-flag"));
      }
    } else {
      for (const match of source.matchAll(new RegExp(`\\b${stubFlag}\\b`, "g")))
        findings.push(finding(file, source, match.index, stubFlag, "stub-flag"));
    }
  }
  return [...findings, ...(await scanBrainKnowledgeImports(root, files))];
}
