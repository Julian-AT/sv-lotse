import type { CaseSummary } from "./schemas.ts";

/** An explicit selection must never silently open a different conversation. */
export function selectInitialCase(cases: CaseSummary[], search: string): CaseSummary | undefined {
  const requested = new URLSearchParams(search).get("caseId");
  if (!requested) return cases[0];
  const selected = cases.find((item) => item.id === requested);
  if (!selected) throw new Error("CASE_ACCESS_DENIED");
  return selected;
}
