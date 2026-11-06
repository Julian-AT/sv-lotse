import type { z } from "zod";
import { deadlineValue, type Obligation, obligationInput } from "./schema.ts";
import { endOfViennaDate } from "./time.ts";

/** Accept explicit, already extracted dates only; never infer deadlines from prose.
 * Fact values use { title, dueAt }; source.quote remains verbatim.
 * Step quotes/titles must be supplied from the process definition by the caller.
 */
export function extractDatedObligations(input: z.input<typeof obligationInput>): Obligation[] {
  const { facts, steps } = obligationInput.parse(input);
  const obligations: Obligation[] = [];
  for (const fact of facts) {
    const value = deadlineValue.safeParse(fact.value);
    const quote = fact.source.quote;
    if (!fact.confirmed || !value.success || typeof quote !== "string" || !quote.trim()) continue;
    const { dueAt, title } = value.data;
    const dateOnly = !dueAt.includes("T");
    const key = `fact:${fact.id}`;
    obligations.push({
      key,
      dueAt: dateOnly ? endOfViennaDate(dueAt) : new Date(dueAt),
      source: {
        kind: "deadline",
        key,
        title,
        sourceQuote: quote,
        ...(dateOnly ? { date: dueAt } : {}),
        provenance: fact.source,
      },
    });
  }
  for (const step of steps) {
    if (!step.dueAt || step.status === "completed") continue;
    const key = `step:${step.id}`;
    obligations.push({
      key,
      dueAt: step.dueAt,
      source: {
        kind: "deadline",
        key,
        title: step.title,
        sourceQuote: step.sourceQuote,
        provenance: { stepId: step.id },
      },
    });
  }
  return obligations;
}
