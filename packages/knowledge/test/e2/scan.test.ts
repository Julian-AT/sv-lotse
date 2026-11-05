import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { scanRepository } from "../../src/e2/index.ts";
import { loadKnowledge } from "../../src/loader/index.ts";
import { fixtureRoot, removeFixture } from "../loader/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixture));
});
test("AC3 e2 scan passes on the current repository", async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  expect(await scanRepository(root, await loadKnowledge())).toEqual([]);
});
test("AC3 catches literal and identifier ids in a temporary repository with file and line", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await mkdir(join(root, "apps/mac/App"), { recursive: true });
  await writeFile(
    join(root, "packages/brain/src/example.ts"),
    '// fixture-benefit\nconst value = "fixture-benefit";\nconst fixture_situation = 1;\nconst escaped = "fixture\\u002doffice";\n',
  );
  await writeFile(
    join(root, "apps/mac/App/Example.swift"),
    '// fixture-benefit\nlet value = #"fixture-facility"#\nlet id = "fixture-form"\n',
  );
  const findings = await scanRepository(root, await loadKnowledge(root));
  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: "packages/brain/src/example.ts",
        line: 2,
        value: "fixture-benefit",
      }),
      expect.objectContaining({
        file: "packages/brain/src/example.ts",
        line: 3,
        value: "fixture_situation",
      }),
      expect.objectContaining({
        file: "packages/brain/src/example.ts",
        line: 4,
        value: "fixture-office",
      }),
      expect.objectContaining({
        file: "apps/mac/App/Example.swift",
        line: 2,
        value: "fixture-facility",
      }),
      expect.objectContaining({
        file: "apps/mac/App/Example.swift",
        line: 3,
        value: "fixture-form",
      }),
    ]),
  );
  expect(findings.some((finding) => finding.line === 1)).toBe(false);
});
test("E2 rejects unapproved stub flag references and permits exact configured build files", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(
    join(root, "packages/brain/src/unsafe.ts"),
    "const flag = process.env.BRAIN_ALLOW_STUBS;\n",
  );
  const knowledge = await loadKnowledge(root);
  expect(await scanRepository(root, knowledge)).toEqual([
    expect.objectContaining({ line: 1, value: "BRAIN_ALLOW_STUBS" }),
  ]);
  expect(
    await scanRepository(root, knowledge, { allowedStubFiles: ["packages/brain/src/unsafe.ts"] }),
  ).toEqual([]);
});
test("AC4 brain never imports knowledge", async () => {
  const { brainKnowledgeImports } = await import("../../src/e2/index.ts");
  expect(
    await brainKnowledgeImports(fileURLToPath(new URL("../../../../", import.meta.url))),
  ).toEqual([]);
});

test("AC3 scan CLI exits nonzero for a forbidden literal in a temporary repository", async () => {
  const { cp } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const root = await fixtureRoot();
  roots.push(root);
  const dataRoot = join(root, "packages/knowledge");
  await mkdir(dataRoot, { recursive: true });
  for (const path of [
    "catalog",
    "processes",
    "offices",
    "facilities",
    "forms",
    "allowlist.yaml",
    "sources.yaml",
  ]) {
    await cp(join(root, path), join(dataRoot, path), { recursive: true });
  }
  const cli = fileURLToPath(new URL("../../src/e2/cli.ts", import.meta.url));
  const clean = spawnSync("bun", [cli, root], { encoding: "utf8" });
  expect(clean.status).toBe(0);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(join(root, "packages/brain/src/example.ts"), 'const value = "fixture-benefit";');
  const failed = spawnSync("bun", [cli, root], { encoding: "utf8" });
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain("packages/brain/src/example.ts:1: catalog-id: fixture-benefit");
});
