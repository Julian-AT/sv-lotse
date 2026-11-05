import { describe, expect, test } from "vitest";
import {
  cohensKappa,
  mean,
  ndcgAtK,
  proportion,
  recallAtK,
  wilsonInterval,
} from "../src/stats/index.ts";

describe("AC1 confidence intervals and calibration", () => {
  test("Wilson matches the 81/100 reference and endpoint samples", () => {
    const interval = wilsonInterval(81, 100);
    if (!interval) throw new Error("Non-empty sample needs an interval");
    expect(interval?.lower).toBeCloseTo(0.7222, 4);
    expect(interval?.upper).toBeCloseTo(0.8749, 4);
    expect(wilsonInterval(0, 10)?.lower).toBe(0);
    expect(wilsonInterval(10, 10)?.upper).toBe(1);
    expect(wilsonInterval(81, 100, 0.99)?.lower).toBeLessThan(interval.lower);
    expect(wilsonInterval(81, 100, 0.8)?.lower).toBeGreaterThan(interval.lower);
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(() => wilsonInterval(2, 1)).toThrow();
    expect(() => wilsonInterval(1, 2, 1)).toThrow();
  });

  test("Cohen's kappa matches the textbook 2 by 2 table 20,5,10,15", () => {
    const a = [...Array<string>(25).fill("yes"), ...Array<string>(25).fill("no")];
    const b = [
      ...Array<string>(20).fill("yes"),
      ...Array<string>(5).fill("no"),
      ...Array<string>(10).fill("yes"),
      ...Array<string>(15).fill("no"),
    ];
    expect(cohensKappa(a, b)).toBeCloseTo(0.4, 12);
    expect(cohensKappa(["a", "b"], ["a", "b"])).toBe(1);
    expect(cohensKappa(["a"], ["a"])).toBeNull();
    expect(() => cohensKappa(["a"], [])).toThrow();
  });

  test("aggregates proportions and means with explicit empty results", () => {
    expect(proportion([true, false, true])).toBeCloseTo(2 / 3);
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
    expect(proportion([])).toBeNull();
    expect(() => mean([Number.NaN])).toThrow();
  });
});

test("AC3 recall@10 and nDCG@10 match a hand-computed ranking", () => {
  const ranking = ["b", "x", "a", "y", "z", "u", "v", "w", "q", "r", "c"];
  const relevance = { a: 3, b: 2, c: 1 };
  // Exponential gains: observed 3 + 7/log2(4); ideal 7 + 3/log2(3) + 1/log2(4).
  expect(recallAtK(ranking, Object.keys(relevance), 10)).toBeCloseTo(2 / 3, 12);
  expect(ndcgAtK(ranking, relevance, 10)).toBeCloseTo(6.5 / (7 + 3 / Math.log2(3) + 0.5), 12);
  expect(recallAtK(["a", "a"], ["a", "b"], 10)).toBe(0.5);
  expect(ndcgAtK(["a", "a"], { a: 1 }, 10)).toBe(1);
  expect(ndcgAtK([], {}, 10)).toBeNull();
  expect(() => recallAtK([], [], -1)).toThrow();
});

test("ranking metrics treat document IDs matching object properties as ordinary IDs", () => {
  expect(ndcgAtK(["constructor", "toString", "a"], { a: 1 }, 10)).toBe(0.5);
});
