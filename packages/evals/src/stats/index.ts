function count(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Expected a non-negative safe integer");
}

// Acklam's rational approximation to the inverse standard normal CDF.
function normalQuantile(p: number): number {
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((-0.007784894002430293 * q - 0.3223964580411365) * q - 2.400758277161838) * q -
        2.549732539343734) *
        q +
        4.374664141464968) *
        q +
        2.938163982698783) /
      ((((0.007784695709041462 * q + 0.3224671290700398) * q + 2.445134137142996) * q +
        3.754408661907416) *
        q +
        1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((-39.69683028665376 * r + 220.9460984245205) * r - 275.9285104469687) * r +
      138.357751867269) *
      r -
      30.66479806614716) *
      r +
      2.506628277459239) *
      q) /
    (((((-54.47609879822406 * r + 161.5858368580409) * r - 155.6989798598866) * r +
      66.80131188771972) *
      r -
      13.28068155288572) *
      r +
      1)
  );
}

export function wilsonInterval(successes: number, total: number, confidence = 0.95) {
  count(successes);
  count(total);
  if (successes > total || !Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new RangeError("Invalid binomial sample or confidence");
  }
  if (total === 0) return null;
  const z = -normalQuantile((1 - confidence) / 2);
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const radius = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return {
    lower: successes === 0 ? 0 : Math.max(0, centre - radius),
    upper: successes === total ? 1 : Math.min(1, centre + radius),
    confidence,
  };
}

export function mean(values: readonly number[]): number | null {
  if (values.some((value) => !Number.isFinite(value)))
    throw new RangeError("Expected finite observations");
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value / values.length, 0);
}

export function proportion(values: readonly boolean[]): number | null {
  return mean(values.map(Number));
}

/** Unweighted kappa; null means agreement is undefined (empty or constant labels). */
export function cohensKappa(a: readonly string[], b: readonly string[]): number | null {
  if (a.length !== b.length) throw new RangeError("Rater samples must have equal lengths");
  if (a.length === 0) return null;
  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  for (const label of a) countsA.set(label, (countsA.get(label) ?? 0) + 1);
  for (const label of b) countsB.set(label, (countsB.get(label) ?? 0) + 1);
  const observed = a.filter((label, i) => label === b[i]).length / a.length;
  let expected = 0;
  for (const [label, n] of countsA)
    expected += (n / a.length) * ((countsB.get(label) ?? 0) / a.length);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

export function recallAtK(
  ranking: readonly string[],
  relevant: readonly string[],
  k: number,
): number | null {
  count(k);
  const gold = new Set(relevant);
  if (gold.size === 0) return null;
  return new Set(ranking.slice(0, k).filter((id) => gold.has(id))).size / gold.size;
}

/** Exponential gain (2^relevance - 1); repeated documents earn no additional gain. */
export function ndcgAtK(
  ranking: readonly string[],
  relevance: Readonly<Record<string, number>>,
  k: number,
): number | null {
  count(k);
  const grades = Object.values(relevance);
  if (grades.some((grade) => !Number.isFinite(grade) || grade < 0 || grade > 30)) {
    throw new RangeError("Relevance grades must be finite and between 0 and 30");
  }
  const gain = (grade: number, i: number) => (2 ** grade - 1) / Math.log2(i + 2);
  const ideal = grades
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, grade, i) => sum + gain(grade, i), 0);
  if (ideal === 0) return null;
  const seen = new Set<string>();
  const observed = ranking.slice(0, k).reduce((sum, id, i) => {
    const grade = seen.has(id) || !Object.hasOwn(relevance, id) ? 0 : (relevance[id] ?? 0);
    seen.add(id);
    return sum + gain(grade, i);
  }, 0);
  return observed / ideal;
}
