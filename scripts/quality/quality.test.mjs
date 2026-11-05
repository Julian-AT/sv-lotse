import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { QUALITY_PROCESS_TIMEOUT_MS } from "./config.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const excluded = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  ".build",
  "dist",
  "coverage",
  "data",
  "orchestration",
  ".orchestration",
  ".agents",
  ".codex",
]);
let directory;

// External tools are real installations. Workspace links point only into the copy.
function linkDependencies(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "@lotse") {
      mkdirSync(join(target, entry.name), { recursive: true });
      for (const workspace of readdirSync(join(source, entry.name))) {
        const parent = workspace === "web" ? "apps" : "packages";
        symlinkSync(join(directory, parent, workspace), join(target, entry.name, workspace));
      }
    } else {
      symlinkSync(join(source, entry.name), join(target, entry.name));
    }
  }
}

before(() => {
  directory = mkdtempSync(join(tmpdir(), "lotse-quality-"));
  cpSync(root, directory, {
    recursive: true,
    filter: (path) =>
      !excluded.has(basename(path)) &&
      !basename(path).startsWith(".env") &&
      path !== join(root, "apps/mac"),
  });
  linkDependencies(join(root, "node_modules"), join(directory, "node_modules"));
  for (const parent of ["packages", "apps"]) {
    for (const workspace of readdirSync(join(directory, parent))) {
      const relative = join(parent, workspace, "node_modules");
      linkDependencies(join(root, relative), join(directory, relative));
    }
  }
});

after(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: "utf8",
    timeout: QUALITY_PROCESS_TIMEOUT_MS,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, output: result.stdout + result.stderr };
}

test("AC1 quality accepts the frozen baseline and rejects each new violation", () => {
  const clean = run("bun", ["run", "quality"]);
  assert.equal(clean.status, 0, clean.output);

  const probe = join(directory, "packages/knowledge/src/wp178-quality-probe.ts");
  // A reachable implementation file proves export checking independently of unused files.
  appendFileSync(
    join(directory, "packages/knowledge/src/index.ts"),
    '\nimport "./wp178-quality-probe.ts";\n',
  );
  const cases = [
    ['export const unusedQualityProbe = "quality";\n', /unusedQualityProbe/],
    ['import "@lotse/brain";\n', /knowledge-no-brain-runtime/],
    ['console.log("quality probe");\n', /noConsole/],
  ];
  for (const [source, diagnostic] of cases) {
    writeFileSync(probe, source);
    const result = run("bun", ["run", "quality"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, diagnostic);
  }
  rmSync(probe);
  writeFileSync(probe, "export {};\n");
});

test("new exports in a baselined file still fail", () => {
  const path = join(directory, "packages/knowledge/src/ingest/fetcher.ts");
  const original = readFileSync(path, "utf8");
  try {
    appendFileSync(path, '\nexport const unusedBaselineProbe = "quality";\n');
    const result = run("bun", ["run", "quality:knip"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /unusedBaselineProbe/);
  } finally {
    writeFileSync(path, original);
  }
});

test("new complex functions in a baselined file still fail", () => {
  const path = join(directory, "packages/guide/src/targets.ts");
  const original = readFileSync(path, "utf8");
  const body = `${"if (value) {".repeat(7)} return value; ${"}".repeat(7)}`;
  try {
    appendFileSync(path, `\nexport function complexityBaselineProbe(value: boolean) { ${body} }\n`);
    const result = run("bun", ["run", "quality:patterns"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /noExcessiveCognitiveComplexity/);
  } finally {
    writeFileSync(path, original);
  }
});

test("architecture rejects leaf, app, private-import and cycle violations", () => {
  const probes = [
    ["packages/db/src/quality-probe.ts", 'import "../../protocol/src/index.ts";\n', /db-is-a-leaf/],
    [
      "packages/knowledge/src/quality-probe.ts",
      'import "../../../apps/web/src/server/health.ts";\n',
      /packages-no-apps/,
    ],
    [
      "packages/knowledge/src/quality-probe.ts",
      'import "../../protocol/src/index.ts";\n',
      /workspace-public-exports-only/,
    ],
    [
      "packages/knowledge/src/quality-probe.ts",
      'import "@lotse/brain/src/db/client.ts";\n',
      /no-unresolved-workspace-imports/,
    ],
    [
      "packages/knowledge/src/quality-probe.ts",
      'import "./quality-probe.ts";\n',
      /no-circular-imports-in-package/,
    ],
  ];
  for (const [relative, source, diagnostic] of probes) {
    const path = join(directory, relative);
    try {
      writeFileSync(path, source);
      const result = run("bun", ["run", "quality:architecture"]);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, diagnostic);
    } finally {
      rmSync(path, { force: true });
    }
  }
});

test("syncpack rejects version drift and internal dependencies without workspace protocol", () => {
  const path = join(directory, "packages/knowledge/package.json");
  const original = readFileSync(path, "utf8");
  for (const [dependency, range] of [
    ["zod", "^3"],
    ["@lotse/brain", "0.0.0"],
  ]) {
    try {
      const manifest = JSON.parse(original);
      manifest.dependencies[dependency] = range;
      writeFileSync(path, JSON.stringify(manifest));
      const result = run("bun", ["run", "quality:versions"]);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, new RegExp(dependency));
    } finally {
      writeFileSync(path, original);
    }
  }
});
