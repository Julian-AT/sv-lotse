import { z } from "zod";
import type { RegisteredSuite } from "./runner/index.ts";

/** Harness self-test only; E1 here is not the product engine evaluation. */
export function createDemoSuite(): RegisteredSuite {
  return {
    suite: {
      id: "E1",
      name: "Arithmetic harness demonstration",
      minimumSetSize: 1,
      gate: { kind: "blocking", metric: "passRate", threshold: 1, direction: "at_least" },
    },
    cases: [1, 2, 3, 4].map((n) => ({
      id: `addition-${n}`,
      kind: "synthetic",
      tags: n === 4 ? ["nightly", "weekly"] : ["pr", "nightly"],
      input: { a: n, b: n + 1 },
      expected: n + n + 1,
    })),
    async execute(item) {
      const { a, b } = z.object({ a: z.number(), b: z.number() }).parse(item.input);
      return { passed: a + b === z.number().parse(item.expected), metrics: {} };
    },
  };
}
