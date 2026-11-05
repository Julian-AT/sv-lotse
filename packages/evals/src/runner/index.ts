import { createHash } from "node:crypto";
import { z } from "zod";
import { TransportError } from "../errors.ts";

import {
  type CaseResult,
  CaseSchema,
  type EvalCase,
  type Evaluation,
  EvaluationSchema,
  SubsetSchema,
  type Suite,
  SuiteIdSchema,
  SuiteResultSchema,
  SuiteSchema,
} from "../schema/index.ts";
import { mean, wilsonInterval } from "../stats/index.ts";

export { TransportError } from "../errors.ts";

export interface RegisteredSuite {
  suite: Suite;
  cases: EvalCase[];
  /** Implementations must propagate the signal to I/O and stop work when aborted. */
  execute(item: EvalCase, context: { signal: AbortSignal; attempt: number }): Promise<Evaluation>;
}

export class Registry {
  private readonly suites = new Map<string, RegisteredSuite>();
  register(definition: RegisteredSuite): void {
    const suite = SuiteSchema.parse(definition.suite);
    if (this.suites.has(suite.id)) throw new Error(`Suite ${suite.id} already registered`);
    const cases = definition.cases.map((item) => CaseSchema.parse(item));
    if (new Set(cases.map((item) => item.id)).size !== cases.length)
      throw new Error("Duplicate case IDs");
    this.suites.set(suite.id, { ...definition, suite, cases });
  }
  get(id: string): RegisteredSuite {
    const suite = this.suites.get(SuiteIdSchema.parse(id));
    if (!suite) throw new Error(`Suite ${id} is not registered`);
    return suite;
  }
  list(): RegisteredSuite[] {
    return [...this.suites.values()].sort(
      (a, b) => Number(a.suite.id.slice(1)) - Number(b.suite.id.slice(1)),
    );
  }
}

const SelectionSchema = z.object({
  subset: SubsetSchema.optional(),
  sample: z.number().int().nonnegative().optional(),
  seed: z.string().min(1).default("0"),
});
export type Selection = z.input<typeof SelectionSchema>;
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Hash-ranked sampling is independent of registry, input order and worker scheduling. */
export function selectCases(cases: readonly EvalCase[], selection: Selection = {}): EvalCase[] {
  const { seed, subset, sample } = SelectionSchema.parse(selection);
  const filtered = cases.filter((item) => !subset || item.tags.includes(subset));
  if (sample === undefined) return [...filtered].sort((a, b) => compare(a.id, b.id));
  const rank = (id: string) =>
    createHash("sha256")
      .update(JSON.stringify([seed, id]))
      .digest("hex");
  return filtered
    .map((item) => ({ item, rank: rank(item.id) }))
    .sort((a, b) => compare(a.rank, b.rank) || compare(a.item.id, b.item.id))
    .slice(0, sample)
    .map(({ item }) => item);
}

class CaseTimeoutError extends Error {}
const RunOptionsSchema = SelectionSchema.extend({
  concurrency: z.number().int().min(1).max(100).default(4),
  timeoutMs: z.number().int().min(1).max(2_147_483_647).default(60_000),
  retries: z.number().int().min(0).max(10).default(2),
  modelVersion: z.string().min(1),
  gitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
});
export type RunOptions = z.input<typeof RunOptionsSchema>;

async function runCase(
  definition: RegisteredSuite,
  item: EvalCase,
  options: z.output<typeof RunOptionsSchema>,
): Promise<CaseResult> {
  const start = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new CaseTimeoutError();
      reject(error);
      controller.abort(error);
    }, options.timeoutMs);
  });
  let attempts = 0;
  const execute = async (): Promise<Evaluation> => {
    for (;;) {
      controller.signal.throwIfAborted();
      attempts++;
      try {
        return await definition.execute(item, { signal: controller.signal, attempt: attempts });
      } catch (error) {
        if (
          !(error instanceof TransportError) ||
          attempts > options.retries ||
          controller.signal.aborted
        )
          throw error;
      }
    }
  };
  try {
    const parsed = EvaluationSchema.safeParse(await Promise.race([execute(), timeout]));
    if (!parsed.success)
      return {
        caseId: item.id,
        status: "error",
        attempts,
        durationMs: performance.now() - start,
        metrics: {},
        error: "invalid_result",
      };
    const { passed, metrics, judge } = parsed.data;
    return {
      caseId: item.id,
      status: passed ? "passed" : "failed",
      attempts,
      durationMs: performance.now() - start,
      metrics,
      ...(judge ? { judge } : {}),
    };
  } catch (error) {
    const timedOut = error instanceof CaseTimeoutError;
    return {
      caseId: item.id,
      status: timedOut ? "timeout" : "error",
      attempts,
      durationMs: performance.now() - start,
      metrics: {},
      error: timedOut ? "timeout" : error instanceof TransportError ? "transport" : "execution",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runSuite(definition: RegisteredSuite, rawOptions: RunOptions) {
  const options = RunOptionsSchema.parse(rawOptions);
  const suite = SuiteSchema.parse(definition.suite);
  const allCases = definition.cases.map((item) => CaseSchema.parse(item));
  if (new Set(allCases.map((item) => item.id)).size !== allCases.length)
    throw new Error("Duplicate case IDs");
  const selected = selectCases(allCases, options);
  const startedAt = new Date().toISOString();
  let cursor = 0;
  const results = new Map<number, CaseResult>();
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      const item = selected[index];
      if (!item) return;
      results.set(index, await runCase(definition, item, options));
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, selected.length) }, worker));
  const cases = [...results.entries()].sort(([a], [b]) => a - b).map(([, result]) => result);
  const passed = cases.filter((item) => item.status === "passed").length;
  const failed = cases.filter((item) => item.status === "failed").length;
  const total = cases.length;
  const errors = total - passed - failed;
  const metricNames = new Set([
    suite.gate.metric,
    ...cases.flatMap((item) => Object.keys(item.metrics)),
  ]);
  const metrics: Record<string, number | null> = { passRate: total ? passed / total : null };
  for (const metric of metricNames) {
    if (metric === "passRate") continue;
    const values = cases.map((item) =>
      Object.hasOwn(item.metrics, metric) ? item.metrics[metric] : undefined,
    );
    metrics[metric] = values.every((value): value is number => value !== undefined)
      ? mean(values)
      : null;
  }
  const value = metrics[suite.gate.metric];
  const meetsThreshold =
    value !== undefined &&
    value !== null &&
    (suite.gate.direction === "at_least"
      ? value >= suite.gate.threshold
      : value <= suite.gate.threshold);
  const judgeVersions = [
    ...new Map(
      cases.flatMap((item) => {
        if (!item.judge) return [];
        const { scores: _scores, ...version } = item.judge;
        return [[JSON.stringify(version), version] as const];
      }),
    ).values(),
  ];
  return SuiteResultSchema.parse({
    schemaVersion: 1,
    suite,
    selection: SelectionSchema.parse(options),
    counts: { total, passed, failed, errors },
    metrics,
    wilson95: wilsonInterval(passed, total),
    gateVerdict:
      total === 0 || total < suite.minimumSetSize
        ? "insufficient_data"
        : meetsThreshold && errors === 0
          ? "passed"
          : "failed",
    modelVersion: options.modelVersion,
    judgeVersions,
    gitSha: options.gitSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    cases,
  });
}
