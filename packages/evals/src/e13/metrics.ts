import { z } from "zod";

const BoxSchema = z.object({
  page: z.number().int().positive(),
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export const EvaluationFieldSchema = z.object({
  box: BoxSchema,
  label_de: z.string().min(1),
  owner: z.enum(["applicant", "doctor", "hospital", "office"]),
});
export type EvaluationField = z.infer<typeof EvaluationFieldSchema>;
type Box = z.infer<typeof BoxSchema>;

export const FieldCountsSchema = z.object({
  goldCount: z.number().int().nonnegative(),
  detectedCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  boxMatchedCount: z.number().int().nonnegative(),
  labelMatchedCount: z.number().int().nonnegative(),
  ownerMatchedCount: z.number().int().nonnegative(),
});

/** The same denominators and PRD targets apply to one form or a whole suite. */
export function summarizeFields(counts: z.infer<typeof FieldCountsSchema>) {
  const {
    goldCount,
    detectedCount,
    matchedCount,
    boxMatchedCount,
    labelMatchedCount,
    ownerMatchedCount,
  } = counts;
  const recall = goldCount ? matchedCount / goldCount : 0;
  const precision = detectedCount ? matchedCount / detectedCount : 0;
  return {
    ...counts,
    boxRecall: goldCount ? boxMatchedCount / goldCount : 0,
    boxPrecision: detectedCount ? boxMatchedCount / detectedCount : 0,
    labelMatch: boxMatchedCount ? labelMatchedCount / boxMatchedCount : 0,
    ownerMatch: boxMatchedCount ? ownerMatchedCount / boxMatchedCount : 0,
    recall,
    precision,
    targetAttainment: Math.min(recall / 0.9, precision / 0.95, 1),
  };
}

export function intersectionOverUnion(a: Box, b: Box): number {
  BoxSchema.parse(a);
  BoxSchema.parse(b);
  if (a.page !== b.page) return 0;
  if (a.width * a.height === 0 || b.width * b.height === 0) return 0;
  const intersection =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase("de-AT")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Maximum bipartite matching prevents duplicates and greedy assignment errors. */
function matchCount(edges: readonly number[][]): number {
  const assigned = new Map<number, number>();
  function assign(detection: number, seen: Set<number>): boolean {
    for (const gold of edges[detection] ?? []) {
      if (seen.has(gold)) continue;
      seen.add(gold);
      const previous = assigned.get(gold);
      if (previous === undefined || assign(previous, seen)) {
        assigned.set(gold, detection);
        return true;
      }
    }
    return false;
  }
  for (let i = 0; i < edges.length; i++) assign(i, new Set());
  return assigned.size;
}

export function measureFields(
  detectedInput: readonly EvaluationField[],
  goldInput: readonly EvaluationField[],
) {
  const detected = z.array(EvaluationFieldSchema).parse(detectedInput);
  const gold = z.array(EvaluationFieldSchema).parse(goldInput);
  const edges = (predicate: (a: EvaluationField, b: EvaluationField) => boolean) =>
    detected.map((candidate) =>
      gold.flatMap((reference, index) =>
        intersectionOverUnion(candidate.box, reference.box) >= 0.5 &&
        predicate(candidate, reference)
          ? [index]
          : [],
      ),
    );
  const boxes = matchCount(edges(() => true));
  const labels = matchCount(
    edges((a, b) => normalizeLabel(a.label_de) === normalizeLabel(b.label_de)),
  );
  const owners = matchCount(edges((a, b) => a.owner === b.owner));
  const matched = matchCount(
    edges(
      (a, b) => a.owner === b.owner && normalizeLabel(a.label_de) === normalizeLabel(b.label_de),
    ),
  );
  return summarizeFields({
    goldCount: gold.length,
    detectedCount: detected.length,
    matchedCount: matched,
    boxMatchedCount: boxes,
    labelMatchedCount: labels,
    ownerMatchedCount: owners,
  });
}
