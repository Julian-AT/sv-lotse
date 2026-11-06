import type { DatabaseClient } from "@lotse/db";
import { caseActors, cases, formInstances } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../../agent/context.ts";
import type { Transaction } from "../../approvals/index.ts";
import { FormError } from "../schema.ts";

export async function authorizeFormCase(
  db: DatabaseClient | Transaction,
  userId: string,
  caseId: string,
  subjectId?: string,
): Promise<void> {
  const [row] = await db
    .select({ subjectId: cases.subjectId })
    .from(cases)
    .innerJoin(
      caseActors,
      and(
        eq(caseActors.caseId, cases.id),
        eq(caseActors.userId, userId),
        eq(caseActors.role, "subject"),
      ),
    )
    .where(eq(cases.id, z.uuid().parse(caseId)));
  if (!row || (subjectId !== undefined && row.subjectId !== subjectId))
    throw new FormError("access_denied");
}

export async function instanceForContext(
  db: DatabaseClient | Transaction,
  id: string,
  context: RuntimeContext,
  lock = false,
): Promise<typeof formInstances.$inferSelect> {
  if (context.actorRole !== "subject") throw new FormError("access_denied");
  await authorizeFormCase(db, context.userId, context.caseId, context.subjectId);
  const query = db
    .select()
    .from(formInstances)
    .where(
      and(
        eq(formInstances.id, z.uuid().parse(id)),
        eq(formInstances.caseId, context.caseId),
        eq(formInstances.subjectId, context.subjectId),
      ),
    );
  const [instance] = await (lock ? query.for("update") : query);
  if (!instance) throw new FormError("not_found");
  return instance;
}
