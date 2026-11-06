import type { DatabaseClient } from "@lotse/db";
import { facts } from "@lotse/db/schema";
import { JsonValueSchema } from "@lotse/protocol";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { Transaction } from "../../approvals/index.ts";
import type { ConfirmedFact } from "../policy.ts";

/** Parse JSON exactly once; the default column decoder reparses scalar JSON strings. */
export async function confirmedFormFacts(
  db: DatabaseClient | Transaction,
  subjectId: string,
): Promise<ConfirmedFact[]> {
  return db
    .select({
      ...getTableColumns(facts),
      value: sql<string>`${facts.value}::text`.mapWith((value) =>
        JsonValueSchema.parse(JSON.parse(value)),
      ),
    })
    .from(facts)
    .where(and(eq(facts.subjectId, subjectId), eq(facts.confirmed, true)));
}
