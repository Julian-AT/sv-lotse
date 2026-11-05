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
    detected.map((a) =>
      gold.flatMap((b, index) =>
        intersectionOverUnion(a.box, b.box) >= 0.5 && predicate(a, b) ? [index] : [],
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
  return {
    boxRecall: gold.length ? boxes / gold.length : 0,
    boxPrecision: detected.length ? boxes / detected.length : 0,
    labelMatch: boxes ? labels / boxes : 0,
    ownerMatch: boxes ? owners / boxes : 0,
    recall: gold.length ? matched / gold.length : 0,
    precision: detected.length ? matched / detected.length : 0,
  };
}
