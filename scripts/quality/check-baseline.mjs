import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { QUALITY_PROCESS_TIMEOUT_MS, QUALITY_REPORT_MAX_BUFFER_BYTES } from "./config.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8"));
const processOptions = {
  cwd: root,
  encoding: "utf8",
  timeout: QUALITY_PROCESS_TIMEOUT_MS,
  maxBuffer: QUALITY_REPORT_MAX_BUFFER_BYTES,
};

function report(binary, args) {
  const result = spawnSync(join(root, "node_modules/.bin", binary), args, processOptions);
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`${binary} analysis failed (${result.status}): ${result.stderr}`);
  }
  // Both tools return 1 when reporting findings. Parse failures must fail closed.
  return JSON.parse(result.stdout);
}

function knipFindings() {
  const text = readFileSync(join(root, "knip.json"), "utf8");
  const config = JSON.parse(text.replace(/^\/\/[^\n]*\n/, ""));
  delete config.ignoreIssues;
  for (const workspace of Object.values(config.workspaces)) delete workspace.ignoreDependencies;
  const temporary = mkdtempSync(join(tmpdir(), "lotse-knip-"));
  try {
    const path = join(temporary, "knip.json");
    writeFileSync(path, JSON.stringify(config));
    const { issues } = report("knip", ["--config", path, "--reporter", "json"]);
    return issues.flatMap(({ file, ...kinds }) =>
      Object.entries(kinds).flatMap(([kind, findings]) =>
        findings.map((finding) => ({ path: file, kind, name: finding.name })),
      ),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function checkKnip() {
  const key = ({ path, kind, name }) => JSON.stringify([path, kind, name]);
  const known = new Set(baseline.knip.map(key));
  return knipFindings()
    .filter((finding) => !known.has(key(finding)))
    .map(({ path, kind, name }) => `${path}: ${kind}: ${name}`);
}

function checkBiome() {
  const { diagnostics, summary } = report("biome", [
    "lint",
    ".",
    "--only=complexity/noExcessiveCognitiveComplexity",
    "--reporter=json",
    "--max-diagnostics=none",
  ]);
  if (summary.diagnosticsNotPrinted !== 0) throw new Error("Biome truncated its findings");
  const remaining = [...baseline.biome];
  return diagnostics.flatMap(({ category, location, message }) => {
    const path = location.path;
    const source = readFileSync(join(root, path), "utf8")
      .split("\n")
      [location.start.line - 1].trim();
    const complexity = Number(/complexity of (\d+)/.exec(message)?.[1]);
    const index = remaining.findIndex(
      (known) => known.path === path && known.source === source && complexity <= known.complexity,
    );
    if (index < 0) return [`${path}:${location.start.line}: ${category}: ${message}`];
    remaining.splice(index, 1);
    return [];
  });
}

const checks = { knip: checkKnip, biome: checkBiome };
const check = checks[process.argv[2]];
if (!check) throw new Error("Expected baseline check: knip or biome");
const findings = check();
if (findings.length > 0) {
  console.error(`New quality findings outside the WP-178 baseline:\n${findings.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`${process.argv[2]} baseline: no new findings`);
}
