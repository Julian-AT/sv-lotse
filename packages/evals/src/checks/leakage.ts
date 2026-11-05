import { z } from "zod";
import { CaseSchema } from "../schema/index.ts";

const CorpusSchema = z.array(z.object({ id: z.string().min(1), text: z.string() }));
export interface Leakage {
  caseId: string;
  corpusId: string;
}
function words(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Contiguous word overlap, excluding source quotes which are required provenance. */
export function checkLeakage(
  items: readonly unknown[],
  corpus: unknown,
  thresholdWords = 20,
): Leakage[] {
  const threshold = z.number().int().positive().parse(thresholdWords);
  const records = CorpusSchema.parse(corpus);
  const index = new Map<string, Set<string>>();
  for (const record of records) {
    const tokens = words(record.text);
    for (let i = 0; i + threshold <= tokens.length; i++) {
      const window = tokens.slice(i, i + threshold).join(" ");
      const ids = index.get(window) ?? new Set<string>();
      ids.add(record.id);
      index.set(window, ids);
    }
  }
  const findings: Leakage[] = [];
  for (const raw of items) {
    const item = CaseSchema.parse(raw);
    if (item.kind !== "gold") continue;
    const matched = new Set<string>();
    for (const text of [...strings(item.input), ...strings(item.expected)]) {
      const tokens = words(text);
      for (let i = 0; i + threshold <= tokens.length; i++) {
        for (const id of index.get(tokens.slice(i, i + threshold).join(" ")) ?? []) matched.add(id);
      }
    }
    for (const corpusId of [...matched].sort()) findings.push({ caseId: item.id, corpusId });
  }
  return findings;
}

export function assertNoLeakage(
  items: readonly unknown[],
  corpus: unknown,
  thresholdWords = 20,
): void {
  if (checkLeakage(items, corpus, thresholdWords).length > 0)
    throw new Error("Gold data leakage detected");
}
