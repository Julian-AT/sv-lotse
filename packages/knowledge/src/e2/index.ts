import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { sourceFiles } from "../loader/files.ts";
import type { Knowledge } from "../loader/index.ts";
import { type ScanConfig, scanConfig, scanRoots, stubFlag } from "./config.ts";
import { codeTokens } from "./tokens.ts";

export interface ScanFinding {
  file: string;
  line: number;
  value: string;
  rule: "catalog-id" | "stub-flag" | "dependency-direction";
}
const scriptExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
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
]);
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
  const findings: ScanFinding[] = [];
  for (const path of await sourceFiles(join(root, "packages/brain"), scriptExtensions, ignored)) {
    const source = await readFile(path, "utf8");
    for (const token of codeTokens(source))
      if (token.value === "@lotse/knowledge" || token.value.startsWith("@lotse/knowledge/"))
        findings.push(
          finding(relative(root, path), source, token.offset, token.value, "dependency-direction"),
        );
  }
  return findings;
}
export async function scanRepository(
  root: string,
  knowledge: Knowledge,
  config: ScanConfig = scanConfig,
): Promise<ScanFinding[]> {
  const ids = catalogIds(knowledge);
  const findings: ScanFinding[] = [];
  for (const directory of [...scanRoots, "scripts"]) {
    const extensions = directory === "apps/mac" ? new Set([".swift"]) : scriptExtensions;
    for (const path of await sourceFiles(join(root, directory), extensions, ignored)) {
      const file = relative(root, path);
      const source = await readFile(path, "utf8");
      for (const token of codeTokens(source, path.endsWith(".swift"))) {
        if (directory !== "scripts") {
          for (const value of new Set([token.value, ...token.value.split(/[^A-Za-z0-9_.-]+/)])) {
            if (ids.has(value))
              findings.push(finding(file, source, token.offset, value, "catalog-id"));
          }
        }
        if (token.value === stubFlag && !config.allowedStubFiles.includes(file))
          findings.push(finding(file, source, token.offset, stubFlag, "stub-flag"));
      }
    }
  }
  return [...findings, ...(await brainKnowledgeImports(root))];
}
