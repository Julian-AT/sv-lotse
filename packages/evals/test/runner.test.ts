import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { createDemoSuite } from "../src/demo.ts";
import { exportResults } from "../src/export.ts";
import { Registry, runSuite, selectCases, TransportError } from "../src/runner/index.ts";
import { CaseSchema, SuiteResultSchema } from "../src/schema/index.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const options = { seed: "fixture", modelVersion: "arithmetic-v1", gitSha: "a".repeat(40) };

test("AC2 same seed and subset select the same cases and order regardless of input order", () => {
  const suite = createDemoSuite();
  const subset = { subset: "pr" as const, sample: 2, seed: "same" };
  const selected = selectCases(suite.cases, subset);
  expect(selected).toEqual(selectCases([...suite.cases].reverse(), subset));
  expect(selected).toHaveLength(2);
  expect(selected.every((item) => item.tags.includes("pr"))).toBe(true);
  expect(selectCases(suite.cases, { subset: "weekly", seed: "same" })).toHaveLength(1);
  expect(() => selectCases(suite.cases, { sample: -1 })).toThrow();
});

test("AC2 demonstration exercises registry, runner, stats, gate and schema-valid export", async () => {
  const registry = new Registry();
  registry.register(createDemoSuite());
  expect(() => registry.register(createDemoSuite())).toThrow();
  expect(() => registry.get("E13")).toThrow();
  const result = await runSuite(registry.get("E1"), options);
  expect(result.counts).toEqual({ total: 4, passed: 4, failed: 0, errors: 0 });
  expect(result.gateVerdict).toBe("passed");
  expect(SuiteResultSchema.parse(result)).toEqual(result);
  const directory = await mkdtemp(join(tmpdir(), "lotse-evals-"));
  directories.push(directory);
  const out = join(directory, "summary.json");
  await exportResults([result], out);
  const summary = JSON.parse(await readFile(out, "utf8"));
  expect(summary.blockingFailures).toEqual([]);
  expect(
    SuiteResultSchema.parse(JSON.parse(await readFile(join(directory, "E1.json"), "utf8"))),
  ).toEqual(result);
});

test("AC2 a failing blocking gate makes the CLI return non-zero and writes the result", async () => {
  const suite = createDemoSuite();
  suite.execute = async () => ({ passed: false, metrics: {} });
  const registry = new Registry();
  registry.register(suite);
  const directory = await mkdtemp(join(tmpdir(), "lotse-evals-"));
  directories.push(directory);
  const code = await runCli(
    ["run", "--suite", "E1", "--out", join(directory, "summary.json")],
    registry,
  );
  expect(code).toBe(1);
  expect(
    JSON.parse(await readFile(join(directory, "summary.json"), "utf8")).blockingFailures,
  ).toEqual(["E1"]);
  suite.suite.gate.kind = "informational";
  const informational = new Registry();
  informational.register(suite);
  expect(
    await runCli(["run", "--suite", "E1", "--out", join(directory, "info.json")], informational),
  ).toBe(0);
});

test("runner bounds concurrency, preserves order and retries only transport errors", async () => {
  const suite = createDemoSuite();
  let active = 0;
  let maximum = 0;
  const attempts = new Map<string, number>();
  suite.execute = async (item) => {
    const n = (attempts.get(item.id) ?? 0) + 1;
    attempts.set(item.id, n);
    if (item.id === "addition-1" && n === 1) throw new TransportError();
    if (item.id === "addition-2") throw new Error("never export this content");
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { passed: true, metrics: {} };
  };
  const result = await runSuite(suite, { ...options, concurrency: 2, retries: 2 });
  expect(maximum).toBeLessThanOrEqual(2);
  expect(result.cases.map((item) => item.caseId)).toEqual(
    suite.cases.map((item) => item.id).sort(),
  );
  expect(attempts.get("addition-1")).toBe(2);
  expect(attempts.get("addition-2")).toBe(1);
  expect(JSON.stringify(result)).not.toContain("never export");
  expect(result.gateVerdict).toBe("failed");
});

test("runner aborts timed-out work without retrying it", async () => {
  const suite = createDemoSuite();
  suite.cases = suite.cases.slice(0, 1);
  suite.suite.minimumSetSize = 1;
  let aborted = false;
  suite.execute = async (_item, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  const result = await runSuite(suite, { ...options, timeoutMs: 10, retries: 3 });
  expect(aborted).toBe(true);
  expect(result.cases[0]?.status).toBe("timeout");
  expect(result.cases[0]?.attempts).toBe(1);
});

test("missing metric coverage and undersized samples cannot pass a gate", async () => {
  const suite = createDemoSuite();
  suite.suite.gate.metric = "recall";
  suite.execute = async (item) => ({
    passed: true,
    metrics: item.id === "addition-1" ? { recall: 1 } : {},
  });
  const result = await runSuite(suite, options);
  expect(result.metrics.recall).toBeNull();
  expect(result.gateVerdict).toBe("failed");
  suite.suite.minimumSetSize = 2;
  const small = await runSuite(suite, { ...options, sample: 1 });
  expect(small.gateVerdict).toBe("insufficient_data");
});

test("gold cases require a source passage at the schema boundary", () => {
  const item = { id: "gold", kind: "gold", tags: ["pr"], input: "question", expected: "answer" };
  expect(CaseSchema.safeParse(item).success).toBe(false);
  expect(
    CaseSchema.safeParse({
      ...item,
      source: { uri: "https://example.org/source", passage: "Source passage" },
    }).success,
  ).toBe(true);
});

test("AC2 a CLI process exits with status 1 on a blocking failure", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const directory = await mkdtemp(join(tmpdir(), "lotse-evals-"));
  directories.push(directory);
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("./fixtures/failing-cli.ts", import.meta.url)),
      "run",
      "--suite",
      "E1",
      "--out",
      join(directory, "summary.json"),
    ],
    { encoding: "utf8" },
  );
  expect(child.status, child.stderr).toBe(1);
  expect(
    JSON.parse(await readFile(join(directory, "summary.json"), "utf8")).blockingFailures,
  ).toEqual(["E1"]);
});

test("runner exports the scored judge model, prompt and rubric versions", async () => {
  const suite = createDemoSuite();
  const judge = {
    model: "judge-snapshot",
    rubricId: "sample",
    rubricVersion: "1",
    promptVersion: "1",
    scores: { correctness: { score: 1, rationale: "Correct arithmetic." } },
  };
  suite.execute = async () => ({ passed: true, metrics: {}, judge });
  const result = await runSuite(suite, options);
  expect(result.judgeVersions).toEqual([
    { model: "judge-snapshot", rubricId: "sample", rubricVersion: "1", promptVersion: "1" },
  ]);
  expect(result.cases.every((item) => item.judge?.scores.correctness?.score === 1)).toBe(true);
});
