import { z } from "zod";
import { boundaryData } from "./data.ts";

export interface RuleViolation {
  patternId: string;
  category: string;
}
/** The caller must remove only quotes already verified against trusted source passages. */
export function checkBoundaryRules(text: string): RuleViolation[] {
  const normalized = z.string().parse(text).normalize("NFKC");
  return boundaryData.patterns
    .filter((rule) => rule.expression.test(normalized))
    .map(({ id, category }) => ({ patternId: id, category }));
}
