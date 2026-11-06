import { z } from "zod";
import { shareScopeSchema } from "./schemas.ts";

const runtimeScope = z.strictObject({
  case: z.boolean(),
  facts: z.union([z.boolean(), z.array(z.string().min(1))]).optional(),
  documents: z.union([z.boolean(), z.array(z.uuid())]).optional(),
});

export interface EffectiveShareScope {
  case: boolean;
  facts: boolean | string[];
  documents: boolean | string[];
  factIds?: string[];
}

/** Both persisted formats are supported; malformed scopes always deny access. */
export function effectiveShareScope(raw: unknown): EffectiveShareScope {
  const scope = shareScopeSchema.safeParse(raw);
  if (scope.success) {
    if (scope.data.mode === "full") return { case: true, facts: true, documents: true };
    const caseAccess = scope.data.case !== false;
    return {
      case: caseAccess,
      facts: caseAccess ? scope.data.factTypes : false,
      factIds: caseAccess ? (scope.data.factIds ?? []) : [],
      documents: caseAccess ? (scope.data.documentIds ?? []) : false,
    };
  }
  const legacy = runtimeScope.safeParse(raw);
  if (legacy.success && legacy.data.case)
    return {
      case: true,
      facts: legacy.data.facts ?? false,
      documents: legacy.data.documents ?? false,
    };
  return { case: false, facts: false, documents: false };
}

export function canReadFactType(raw: unknown, type: string, factId?: string): boolean {
  const { facts, factIds } = effectiveShareScope(raw);
  return (
    facts === true ||
    (Array.isArray(facts) && facts.includes(type)) ||
    (factId !== undefined && factIds?.includes(factId) === true)
  );
}
