import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}
const files = sourceFiles(new URL("../../src", import.meta.url).pathname);

test("AC4 source never invokes click, submit or requestSubmit or dispatches those events", () => {
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(
      /(?:\.|\[\s*["'`])\s*(?:click|submit|requestSubmit)["'`\]]*\s*(?:\?\.)?\s*\(/u,
    );
    expect(source, file).not.toMatch(/new\s+(?:\w+\.)?(?:MouseEvent|PointerEvent)\s*\(/u);
    expect(source, file).not.toMatch(/(?:Event|dispatchEvent)\s*\(\s*["'`](?:click|submit)["'`]/u);
  }
});

test("AC6 browser source has no network or Node API use", () => {
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/u);
    expect(source, file).not.toMatch(
      /(?:from\s*|import\s*\()["'](?:node:|fs|http|https|net|child_process)/u,
    );
  }
});
