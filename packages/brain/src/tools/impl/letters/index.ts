import { DeadlineError } from "../../../deadlines/schema.ts";
import { createDeadlineService } from "../../../deadlines/service.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "docs.explainLetter": async (raw, context, options) => {
      const input = contracts["docs.explainLetter"].input.parse(raw);
      if (input.caseId !== context.caseId || context.actorRole !== "subject")
        throw new DeadlineError("access_denied");
      return createDeadlineService(requireDatabase(deps), context.userId).explainLetter(
        input.caseId,
        input.documentId,
        options.abortSignal,
      );
    },
  };
}
