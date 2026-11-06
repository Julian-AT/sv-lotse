import { DeadlineError } from "../../../deadlines/schema.ts";
import { createDeadlineService } from "../../../deadlines/service.ts";
import { contracts } from "../../contracts/index.ts";
import { reminderRecord } from "../../contracts/reminders.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "reminder.create": async (raw, context) => {
      const input = contracts["reminder.create"].input.parse(raw);
      if (input.caseId !== context.caseId || context.actorRole !== "subject")
        throw new DeadlineError("access_denied");
      const row = await createDeadlineService(requireDatabase(deps), context.userId).create(input);
      return { ...input, id: row.id };
    },
    "reminder.list": async (raw, context) => {
      const input = contracts["reminder.list"].input.parse(raw);
      if (input.caseId !== context.caseId || context.actorRole !== "subject")
        throw new DeadlineError("access_denied");
      return (
        await createDeadlineService(requireDatabase(deps), context.userId).list(input.caseId)
      ).map(reminderRecord);
    },
    "reminder.extract": async (raw, context, options) => {
      const input = contracts["reminder.extract"].input.parse(raw);
      if (input.caseId !== context.caseId || context.actorRole !== "subject")
        throw new DeadlineError("access_denied");
      const result = await createDeadlineService(requireDatabase(deps), context.userId).extract(
        input,
        options.abortSignal,
      );
      return { ...result, reminders: result.reminders.map(reminderRecord) };
    },
  };
}
