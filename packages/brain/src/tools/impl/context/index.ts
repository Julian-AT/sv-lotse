import { facts } from "@lotse/db/schema";
import { FactSchema } from "@lotse/protocol";
import { and, eq, inArray } from "drizzle-orm";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "context.queryFacts": async (raw, context) => {
      const input = contracts["context.queryFacts"].input.parse(raw);
      if (input.subjectId !== context.subjectId) throw new Error("Subject access denied");
      const allowed =
        context.actorRole === "subject"
          ? input.factTypes
          : input.factTypes.filter((type) => {
              const scope = context.shareScope.facts;
              return scope === true || (Array.isArray(scope) && scope.includes(type));
            });
      if (allowed.length === 0) return [];
      const rows = await requireDatabase(deps)
        .select()
        .from(facts)
        .where(and(eq(facts.subjectId, context.subjectId), inArray(facts.type, allowed)));
      return rows.map((row) =>
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
    },
  };
}
