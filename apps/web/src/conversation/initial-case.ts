import type { CaseSummary } from "./schemas.ts";

/** Case ids are UUIDs; the Mac app may send them upper-case, the API returns them lower-case. */
export function normalizeCaseId(id: string): string {
  return id.trim().toLowerCase();
}

/** The requested case id from a location search string, normalized; undefined when absent. */
export function requestedCaseId(search: string): string | undefined {
  const requested = new URLSearchParams(search).get("caseId");
  return requested ? normalizeCaseId(requested) : undefined;
}

/** Finds a case by id regardless of letter case. */
export function findCase(cases: CaseSummary[], id: string): CaseSummary | undefined {
  const wanted = normalizeCaseId(id);
  return cases.find((item) => normalizeCaseId(item.id) === wanted);
}

/** An explicit selection must never silently open a different conversation. */
export function selectInitialCase(cases: CaseSummary[], search: string): CaseSummary | undefined {
  const requested = requestedCaseId(search);
  if (!requested) return cases[0];
  const selected = findCase(cases, requested);
  if (!selected) throw new Error("CASE_ACCESS_DENIED");
  return selected;
}
