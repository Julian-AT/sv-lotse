import { createDocumentService } from "../../../documents/service.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "docs.extractStatements": async (raw, context, options) => {
      const input = contracts["docs.extractStatements"].input.parse(raw);
      const result = await createDocumentService(requireDatabase(deps), context.userId).extract(
        { ...input, subjectId: context.subjectId, caseId: context.caseId },
        options.abortSignal,
      );
      return result.statements;
    },
  };
}
