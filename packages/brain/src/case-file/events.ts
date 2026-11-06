import { randomUUID } from "node:crypto";
import { messages } from "@lotse/db/schema";
import { type CaseEvent, CaseEventSchema } from "@lotse/protocol";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolName } from "../tools/contracts/index.ts";
import type { ToolDependencies } from "../tools/types.ts";
import type { CaseTransaction } from "./schema.ts";

/** Caller holds the case lock, shared with the turn writer's position allocation. */
export async function appendCaseEvent(tx: CaseTransaction, event: CaseEvent): Promise<void> {
  const data = CaseEventSchema.parse(event);
  const [last] = await tx
    .select({ position: messages.position })
    .from(messages)
    .where(eq(messages.caseId, data.caseId))
    .orderBy(desc(messages.position))
    .limit(1);
  await tx.insert(messages).values({
    caseId: data.caseId,
    position: (last?.position ?? -1) + 1,
    uiMessage: { id: randomUUID(), role: "assistant", parts: [{ type: "data-case-event", data }] },
  });
}

export function emitCaseEvents(
  deps: ToolDependencies,
  name: ToolName,
  caseId: string,
  output: unknown,
): void {
  if (!deps.writer) return;
  const events: CaseEvent[] = [];
  if (name === "case.update" && Array.isArray(output)) {
    for (const value of output) events.push(CaseEventSchema.parse(value));
  } else if (name === "handoff.compose") {
    events.push(CaseEventSchema.parse({ caseId, kind: "artefact_ready", payload: output }));
  } else if (name === "reminder.create") {
    events.push(CaseEventSchema.parse({ caseId, kind: "reminder_created", payload: output }));
  } else if (name === "reminder.extract") {
    const result = z.object({ reminders: z.array(z.json()) }).parse(output);
    for (const reminder of result.reminders)
      events.push(CaseEventSchema.parse({ caseId, kind: "reminder_created", payload: reminder }));
  } else if (name === "process.start" || name === "process.completeStep") {
    const result = z.object({ steps: z.array(z.json()) }).parse(output);
    for (const value of result.steps) {
      const step = z.object({ status: z.string() }).parse(value);
      events.push(
        CaseEventSchema.parse({
          caseId,
          kind: step.status === "completed" ? "step_completed" : "step_created",
          payload: value,
        }),
      );
    }
  }
  for (const data of events) deps.writer.write({ type: "data-case-event", data });
}
