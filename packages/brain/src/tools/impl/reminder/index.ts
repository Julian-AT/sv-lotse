import { reminders } from "@lotse/db/schema";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies): Implementations {
  return {
    "reminder.create": async (raw, context) => {
      const input = contracts["reminder.create"].input.parse(raw);
      if (input.caseId !== context.caseId || context.actorRole !== "subject")
        throw new Error("Case access denied");
      const [row] = await requireDatabase(deps)
        .insert(reminders)
        .values({
          caseId: context.caseId,
          dueAt: new Date(input.dueAt),
          source: { title: input.title, quote: input.sourceQuote },
        })
        .returning({ id: reminders.id });
      if (!row) throw new Error("Reminder was not saved");
      return { ...input, id: row.id };
    },
  };
}
