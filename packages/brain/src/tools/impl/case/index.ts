import { cases } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies): Implementations {
  return {
    "case.update": async (raw, context) => {
      const { caseId, patch } = contracts["case.update"].input.parse(raw);
      if (caseId !== context.caseId || context.actorRole !== "subject")
        throw new Error("Case access denied");
      if (Object.keys(patch).length === 0) return [];
      const [row] = await requireDatabase(deps)
        .update(cases)
        .set(patch)
        .where(and(eq(cases.id, context.caseId), eq(cases.subjectId, context.subjectId)))
        .returning({ id: cases.id });
      if (!row) throw new Error("Case access denied");
      return patch.confirmedGoal === undefined
        ? []
        : [{ caseId: row.id, kind: "goal_confirmed", payload: { goal: patch.confirmedGoal } }];
    },
  };
}
