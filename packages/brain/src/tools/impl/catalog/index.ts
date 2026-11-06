import type { DatabaseClient } from "@lotse/db";
import { benefits, documents, facts, processes } from "@lotse/db/schema";
import { FactSchema } from "@lotse/protocol";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { CATALOG_FACT_TYPES } from "../../../config/index.ts";
import { contracts } from "../../contracts/index.ts";
import { benefitRecordSchema } from "../../contracts/records.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";
import { assembleBundles, projectBundles } from "./bundles.ts";
import { CatalogError } from "./errors.ts";

const processSlots = z.object({
  benefit: z.string(),
  slots: z.array(z.object({ type: z.string() })),
});

function catalogDatabase(deps: ToolDependencies): DatabaseClient {
  if (!deps.db) throw new CatalogError("CATALOG_DATABASE_REQUIRED");
  return deps.db;
}

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "catalog.findBenefits": async (raw, context) => {
      const input = contracts["catalog.findBenefits"].input.parse(raw);
      const db = catalogDatabase(deps);
      const rows = await db.select({ record: benefits.record }).from(benefits);
      const records = rows.map((row) => benefitRecordSchema.parse(row.record));
      const storedFacts = await db
        .select()
        .from(facts)
        .where(eq(facts.subjectId, context.subjectId))
        .orderBy(asc(facts.createdAt), asc(facts.id));
      const visibleFacts = storedFacts.filter((row) => {
        if (context.actorRole === "subject") return true;
        const scope = context.shareScope.facts;
        return scope === true || (Array.isArray(scope) && scope.includes(row.type));
      });
      const imported = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.subjectId, context.subjectId));
      const documentIds = new Set(imported.map((row) => row.id));
      const confirmed = visibleFacts
        .filter(
          (row) =>
            row.confirmed &&
            (row.type !== CATALOG_FACT_TYPES.vaccination ||
              (row.documentId !== null &&
                documentIds.has(row.documentId) &&
                row.source.documentId === row.documentId)),
        )
        .map((row) =>
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
      const definitions = await db.select({ record: processes.record }).from(processes);
      const vaccinationBenefits = new Set<string>();
      for (const row of definitions) {
        const definition = processSlots.parse(row.record);
        if (definition.slots.some((slot) => slot.type === `fact:${CATALOG_FACT_TYPES.vaccination}`))
          vaccinationBenefits.add(definition.benefit.replace(/^ref:catalog\//, ""));
      }
      return projectBundles(assembleBundles(records, input, confirmed, vaccinationBenefits));
    },
    "catalog.getBenefit": async (raw) => {
      const input = contracts["catalog.getBenefit"].input.parse(raw);
      const [row] = await catalogDatabase(deps)
        .select({ record: benefits.record })
        .from(benefits)
        .where(eq(benefits.key, input.benefitId));
      if (!row) throw new CatalogError("CATALOG_BENEFIT_NOT_FOUND");
      return benefitRecordSchema.parse(row.record);
    },
  };
}
