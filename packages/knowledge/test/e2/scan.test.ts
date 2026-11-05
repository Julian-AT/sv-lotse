import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { isRegularSource, repositoryFiles } from "../../src/e2/files.ts";
import { scanRepository } from "../../src/e2/index.ts";
import { loadKnowledge } from "../../src/loader/index.ts";
import { fixtureRoot, form, removeFixture } from "../loader/fixtures.ts";

async function emptyGitRepository(root: string): Promise<void> {
  // Construct empty metadata without running Git commands that write.
  await mkdir(join(root, ".git/objects"), { recursive: true });
  await mkdir(join(root, ".git/refs/heads"), { recursive: true });
  await writeFile(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
}

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(removeFixture));
});
test("AC3 E2 excludes untracked sources and build symlinks from Git candidates", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await emptyGitRepository(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(join(root, "packages/brain/src/example.ts"), 'const id = "fixture-benefit";');
  await mkdir(join(root, "apps/mac/Untracked/RustLiveKitFFI.framework"), { recursive: true });
  await symlink(
    join(root, "missing-headers"),
    join(root, "apps/mac/Untracked/RustLiveKitFFI.framework/Headers"),
  );
  await writeFile(join(root, "release.sh"), "BRAIN_ALLOW_STUBS=1");

  expect(await repositoryFiles(root)).toEqual([]);
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([]);
});

test("AC3 E2 keeps tracked source files in the Git candidate set", async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  expect(await repositoryFiles(root)).toEqual(
    expect.arrayContaining(["package.json", "packages/knowledge/src/e2/files.ts"]),
  );
});

test("AC3 E2 still refuses symlinks in tracked source paths", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await symlink(join(root, "missing-source.ts"), join(root, "source.ts"));
  await expect(isRegularSource(root, "source.ts")).rejects.toThrow(
    "symbolic links are not supported",
  );
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
    '// fixture-benefit\nconst value = "fixture-benefit";\nconst care = 1;\nconst escaped = "fixture\\u002doffice";\n',
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
        value: "care",
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
test("AC4 knowledge never imports brain and brain uses public knowledge exports", async () => {
  const { dependencyDirectionImports } = await import("../../src/e2/index.ts");
  expect(
    await dependencyDirectionImports(fileURLToPath(new URL("../../../../", import.meta.url))),
  ).toEqual([]);
});

test("AC4 rejects reverse dependencies and private imports while permitting public loader exports", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await mkdir(join(root, "packages/knowledge/src"), { recursive: true });
  await writeFile(
    join(root, "packages/brain/src/public.ts"),
    'import { loadEko } from "@lotse/knowledge/loaders/eko";',
  );
  await writeFile(
    join(root, "packages/brain/src/private.ts"),
    'import { loadEko } from "@lotse/knowledge/src/loaders/eko/index.ts";',
  );
  await writeFile(
    join(root, "packages/knowledge/src/reverse.ts"),
    'import { createDatabase } from "@lotse/brain/db";',
  );
  const findings = await scanRepository(root, await loadKnowledge(root));
  expect(findings).toHaveLength(2);
  expect(findings.map(({ file, rule }) => ({ file, rule }))).toEqual([
    { file: "packages/brain/src/private.ts", rule: "dependency-direction" },
    { file: "packages/knowledge/src/reverse.ts", rule: "dependency-direction" },
  ]);
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

test.each([false, true])(
  "AC2 E2 applies gitignore rules without Git (metadata: %s)",
  async (metadata) => {
    const root = await fixtureRoot();
    roots.push(root);
    if (metadata) {
      await emptyGitRepository(root);
      vi.stubEnv("PATH", "");
    }
    await mkdir(join(root, "packages/brain/src"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "local-release.sh\nlocal.ts\n");
    await writeFile(join(root, "local-release.sh"), "BRAIN_ALLOW_STUBS=1\n");
    await writeFile(
      join(root, "packages/brain/src/local.ts"),
      'import "@lotse/knowledge"; const id = "fixture-benefit"; process.env.BRAIN_ALLOW_STUBS;\n',
    );
    expect(await scanRepository(root, await loadKnowledge(root))).toEqual([]);
  },
);

test("AC3 archive scanning respects nested gitignore rules and negations", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  const directory = "packages/brain/src";
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, ".gitignore"), "*.ts\n");
  await writeFile(join(root, directory, ".gitignore"), "!checked.ts\n");
  await writeFile(join(root, directory, "ignored.ts"), 'const id = "fixture-benefit";');
  await writeFile(join(root, directory, "checked.ts"), 'const id = "fixture-benefit";');

  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    { file: `${directory}/checked.ts`, line: 1, value: "fixture-benefit", rule: "catalog-id" },
  ]);
});

test("AC3 archive scanning skips untracked build folders and symbolic links", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  for (const directory of ["DerivedData", ".build", "node_modules", "test-results"]) {
    await mkdir(join(root, "apps/mac", directory), { recursive: true });
    await writeFile(join(root, "apps/mac", directory, "release.sh"), "BRAIN_ALLOW_STUBS=1");
    await symlink(join(root, "missing"), join(root, "apps/mac", directory, "Headers"));
  }
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await symlink(join(root, "missing"), join(root, "packages/brain/src/link.ts"));
  await symlink(join(root, "missing"), join(root, ".gitignore"));
  await writeFile(join(root, "packages/brain/src/provider.ts"), 'export * from "./stubs.ts";');

  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    expect.objectContaining({ rule: "release-source", value: "./stubs.ts" }),
  ]);
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

test.each([
  "../test/provider.ts",
  "../fixtures/provider.ts",
  "./stubs.ts",
  "@lotse/brain/test/provider",
  "./provider.mock.ts",
])("NFR-17 production sources cannot import test-only providers: %s", async (specifier) => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(join(root, "packages/brain/src/provider.ts"), `export * from "${specifier}";`);
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    expect.objectContaining({ rule: "release-source", value: specifier }),
  ]);
});

test("NFR-17 detects fixture factories even without the environment switch", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(
    join(root, "packages/brain/src/provider.ts"),
    "export const provider = stubGroup({});",
  );
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    expect.objectContaining({ rule: "release-source", value: "stubGroup" }),
  ]);
});

test("NFR-17 scans container source archives without Git or private dotenv access", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await symlink(join(root, "missing-private-file"), join(root, ".env.local"));
  await mkdir(join(root, "packages/brain/src"), { recursive: true });
  await writeFile(join(root, "packages/brain/src/provider.ts"), 'export * from "./stubs.ts";');
  expect(await scanRepository(root, await loadKnowledge(root))).toEqual([
    expect.objectContaining({ rule: "release-source", value: "./stubs.ts" }),
  ]);
});

test("NFR-17 release validation refuses an enabled inherited stub flag", async () => {
  const { spawnSync } = await import("node:child_process");
  const cli = fileURLToPath(new URL("../../src/e2/cli.ts", import.meta.url));
  const result = spawnSync("bun", [cli], {
    encoding: "utf8",
    env: { ...process.env, BRAIN_ALLOW_STUBS: "1" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("BRAIN_ALLOW_STUBS must be unset");
  // The disabled value from a local .env file is not a stub opt-in.
  const disabled = spawnSync("bun", [cli], {
    encoding: "utf8",
    env: { ...process.env, BRAIN_ALLOW_STUBS: "0" },
  });
  expect(disabled.stderr).not.toContain("must be unset");
});
