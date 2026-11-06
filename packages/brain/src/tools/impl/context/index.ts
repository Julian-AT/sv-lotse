import { caseActors, cases, facts } from "@lotse/db/schema";
import { FactSchema } from "@lotse/protocol";
import { and, eq, inArray } from "drizzle-orm";
import { canReadFactType } from "../../../subjects/access.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "context.queryFacts": async (raw, context) => {
      const input = contracts["context.queryFacts"].input.parse(raw);
      if (input.subjectId !== context.subjectId) throw new Error("Subject access denied");
      return requireDatabase(deps).transaction(async (tx) => {
        // Reload and lock the persisted actor: an in-flight turn may outlive a scope change.
        const [actor] = await tx
          .select({ role: caseActors.role, shareScope: caseActors.shareScope })
          .from(caseActors)
          .innerJoin(cases, eq(cases.id, caseActors.caseId))
          .where(
            and(
              eq(caseActors.id, context.actorId),
              eq(caseActors.caseId, context.caseId),
              eq(caseActors.userId, context.userId),
              eq(cases.subjectId, context.subjectId),
            ),
          )
          .for("share");
        if (!actor) return [];
        if (input.factTypes.length === 0) return [];
        const rows = await tx
          .select()
          .from(facts)
          .where(
            and(
              eq(facts.subjectId, context.subjectId),
              eq(facts.confirmed, true),
              inArray(facts.type, input.factTypes),
            ),
          );
        const visible =
          actor.role === "subject"
            ? rows
            : rows.filter((row) => canReadFactType(actor.shareScope, row.type, row.id));
        return visible.map((row) =>
          FactSchema.parse({
            id: row.id,
            subjectId: row.subjectId,
            type: row.type,
            value: row.value,
            source: row.source,
            confidence: row.confidence,
            confirmed: row.confirmed,
          }),
        );
      });
    },
  };
}
