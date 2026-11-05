import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { scanRepository } from "../../src/e2/index.ts";
import { loadKnowledge } from "../../src/loader/index.ts";
import { form, fixtureRoot as knowledgeFixtureRoot, removeFixture } from "../loader/fixtures.ts";

async function fixtureRoot(overrides: Record<string, unknown> = {}) {
  const root = await knowledgeFixtureRoot(overrides);
  // An empty Git repository makes all fixture files untracked candidates without Git writes.
  await mkdir(join(root, ".git/objects"), { recursive: true });
  await mkdir(join(root, ".git/refs/heads"), { recursive: true });
  await writeFile(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  return root;
}

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

test.each(["ts", "tsx", "js", "mjs"])(
  "AC1 E2 detects literals after postfix division in %s sources",
  async (extension) => {
    const root = await fixtureRoot();
    roots.push(root);
    await mkdir(join(root, "apps/web/src"), { recursive: true });
    const file = `apps/web/src/example.${extension}`;
    await writeFile(join(root, file), 'counter++ / "fixture-benefit".length;');
    expect(await scanRepository(root, await loadKnowledge(root))).toContainEqual({
      file,
      line: 1,
      value: "fixture-benefit",
      rule: "catalog-id",
    });
  },
);

test.each([
  "apps/web/next.config.mjs",
  "packages/extra/src/flag.ts",
  "apps/new-client/src/flag.tsx",
  "scripts/release.sh",
  "tools/release.mjs",
  "package.json",
  ".github/workflows/release.yml",
  "Dockerfile",
  "Dockerfile.release",
  "apps/web/Dockerfile.production",
  ".env.example",
  "apps/web/.env.example",
  "scripts/release.py",
  "packages/extra/data/config.ts",
  "packages/extra/test/unexpected.test.ts",
  "packages/extra/generated/config.ts",
])(
  "AC2 E2 checks stub references repository-wide in %s with exact-path exceptions",
  async (file) => {
    const root = await fixtureRoot();
    roots.push(root);
    await mkdir(join(root, file, ".."), { recursive: true });
    const source = file.endsWith(".json")
      ? '{"scripts":{"build":"BRAIN_ALLOW_STUBS=1 next build"}}'
      : "BRAIN_ALLOW_STUBS=1";
    await writeFile(join(root, file), source);
    const knowledge = await loadKnowledge(root);
    const expected = { file, line: 1, value: "BRAIN_ALLOW_STUBS", rule: "stub-flag" };
    expect(await scanRepository(root, knowledge)).toEqual([expected]);
    expect(await scanRepository(root, knowledge, { allowedStubFiles: [file] })).toEqual([]);
    expect(
      await scanRepository(root, knowledge, { allowedStubFiles: [join(file, ".."), `${file}*`] }),
    ).toEqual([expected]);
  },
);

test("AC2 E2 ignores Git-ignored files containing stub references", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "local-release.sh\nlocal.ts\n");
  await writeFile(join(root, "local-release.sh"), "BRAIN_ALLOW_STUBS=1\n");
  await writeFile(
    join(root, "packages/brain/src/local.ts"),
    'import "@lotse/knowledge"; const id = "fixture-benefit"; process.env.BRAIN_ALLOW_STUBS;\n',
  );
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([]);
});

test.each([".env", ".env.production", ".env.local", "apps/web/.env.production.local"])(
  "AC2 E2 excludes private dotenv file %s even when Git does not ignore it",
  async (file) => {
    const root = await fixtureRoot();
    roots.push(root);
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "BRAIN_ALLOW_STUBS=1\n");
    expect(await scanRepository(root, await loadKnowledge(root))).toEqual([]);
  },
);

test("AC2 E2 never opens private dotenv paths", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await symlink(join(root, "missing-private-file"), join(root, ".env.local"));
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([]);
});

test("AC4 E2 rejects form template UUID literals", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  const file = "packages/brain/src/template.ts";
  await writeFile(join(root, file), `const id = "${form.template_id}";`);
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    { file, line: 1, value: form.template_id, rule: "catalog-id" },
  ]);
});

test.each([
  [form.template_id, form.template_id.toUpperCase()],
  [form.template_id.toUpperCase(), form.template_id],
])("AC4 E2 matches template UUID %s against literal %s", async (templateId, literal) => {
  const root = await fixtureRoot({ "forms/form.json": { ...form, template_id: templateId } });
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  const file = "packages/brain/src/template.ts";
  await writeFile(join(root, file), `const id = "${literal}";`);
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    { file, line: 1, value: literal, rule: "catalog-id" },
  ]);
});

test("AC4 E2 preserves case-sensitive matching for other catalog ids", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(
    join(root, "packages/brain/src/example.ts"),
    'const id = "FIXTURE-BENEFIT"; const situation = "FIXTURE_SITUATION";',
  );
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([]);
});

test.each([
  '<div data-benefit-id="fixture&#45;benefit" />',
  "<div>fixture&#45;benefit</div>",
  '<div data-benefit-id="fixture&#x2d;benefit" />',
  "<div>fixture&#x2D;benefit</div>",
])("AC1 E2 detects JSX character references in %s", async (jsx) => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "apps/web/src"), { recursive: true });
  const file = "apps/web/src/example.tsx";
  await writeFile(join(root, file), `const view =\n${jsx};`);
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    { file, line: 2, value: "fixture-benefit", rule: "catalog-id" },
  ]);
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
