import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, generatedPaths } from "./generate.ts";

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected generated entry: ${path}`);
  }
  return result.sort();
}

async function compare(expected: string, actual: string): Promise<void> {
  for (const directory of generatedPaths) {
    const expectedFiles = (await files(join(expected, directory))).map((path) =>
      relative(expected, path),
    );
    const actualFiles = (await files(join(actual, directory))).map((path) =>
      relative(actual, path),
    );
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
      throw new Error(
        `Generated file list differs in ${directory}; run bun run --filter @lotse/protocol generate`,
      );
    }
    for (const path of expectedFiles) {
      const left = await readFile(join(expected, path));
      const right = await readFile(join(actual, path));
      if (!left.equals(right)) throw new Error(`Generated content differs: ${path}`);
    }
  }
}

const temporary = await mkdtemp(join(tmpdir(), "lotse-protocol-check-"));
try {
  const first = join(temporary, "first");
  const second = join(temporary, "second");
  await generate(first);
  await generate(second);
  await compare(first, second);
  await compare(fileURLToPath(new URL("../", import.meta.url)), first);
  console.log(
    "Generated JSON Schema and Swift match; two independent generations are byte-identical.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
