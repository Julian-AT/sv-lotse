import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  SozdokDirectoryError,
  sozdokDirectory,
  sozdokFiles,
} from "../../../src/loaders/sozdok/directory.ts";
import { sozdokChunks } from "../../../src/loaders/sozdok/load.ts";
import { readSozdok } from "../../../src/loaders/sozdok/parse.ts";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const run = promisify(execFile);
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sozdok-paths-"));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("resolves the default corpus from the repository rather than the package working directory", () => {
  expect(sozdokDirectory({})).toBe(join(repositoryRoot, "data/svbox/Rechtstexte"));
});

test("resolves relative SVBOX_DIR values from the repository root", () => {
  expect(sozdokDirectory({ SVBOX_DIR: "private/challenge" })).toBe(
    join(repositoryRoot, "private/challenge/Rechtstexte"),
  );
});

test("accepts an absolute SVBOX_DIR pointing to the parent of Rechtstexte", () => {
  expect(sozdokDirectory({ SVBOX_DIR: root })).toBe(join(root, "Rechtstexte"));
});

test("rejects a blank SVBOX_DIR instead of accidentally reading the working directory", () => {
  expect(() => sozdokDirectory({ SVBOX_DIR: " " })).toThrow();
});

test("loaders explain how to install missing private XML data", async () => {
  const directory = join(root, "missing/Rechtstexte");
  for (const load of [
    readSozdok,
    sozdokFiles,
    (path: string) => sozdokChunks({ directory: path }),
  ]) {
    await expect(load(directory)).rejects.toBeInstanceOf(SozdokDirectoryError);
    await expect(load(directory)).rejects.toThrow(/SVBOX_DIR.*parent directory/);
    await expect(load(directory)).rejects.toThrow(directory);
  }
});

test("an empty directory or a file at the corpus path gets the same actionable error", async () => {
  const directory = join(root, "empty");
  const file = join(root, "not-a-directory");
  await mkdir(directory);
  await writeFile(file, "");
  await expect(readSozdok(directory)).rejects.toBeInstanceOf(SozdokDirectoryError);
  await expect(readSozdok(file)).rejects.toBeInstanceOf(SozdokDirectoryError);
});

test("explicit relative subset directories also resolve from the repository root", async () => {
  const directory = join(root, "subset");
  await mkdir(directory);
  await writeFile(join(directory, "b.xml"), "<invalid/>");
  await writeFile(join(directory, "a.xml"), "<invalid/>");
  await writeFile(join(directory, "README.txt"), "not XML");
  await mkdir(join(directory, "nested.xml"));
  expect(await sozdokFiles(relative(repositoryRoot, directory))).toEqual([
    join(directory, "a.xml"),
    join(directory, "b.xml"),
  ]);
  // Malformed content is a parser failure, never treated as optional missing data.
  await expect(readSozdok(directory)).rejects.toThrow(/Invalid SozDok XML/);
});

test.each([
  ["src/loaders/sozdok/cli.ts", repositoryRoot],
  ["src/loaders/sozdok/cli.ts", packageRoot],
  ["src/ingest/pilot-cli.ts", packageRoot],
])("%s fails helpfully before accessing services from %s", async (script, cwd) => {
  const result = run("bun", [join(packageRoot, script)], {
    cwd,
    env: { ...process.env, SVBOX_DIR: join(root, "missing-cli") },
    timeout: 15_000,
  });
  await expect(result).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Rechtstexte is not tracked in git"),
  });
  await expect(result).rejects.toMatchObject({
    stderr: expect.stringContaining("set SVBOX_DIR to the SV-Box parent directory"),
  });
});

test("the CLI explains a missing explicit subset directory", async () => {
  const result = run("bun", ["run", "sozdok:load", "--directory", join(root, "missing-subset")], {
    cwd: packageRoot,
    env: process.env,
    timeout: 15_000,
  });
  await expect(result).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(join(root, "missing-subset")),
  });
});
