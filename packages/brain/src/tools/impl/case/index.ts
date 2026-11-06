import { CaseFileError } from "../../../case-file/schema.ts";
import { createCaseFileService } from "../../../case-file/service.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies): Implementations {
  return {
    "case.update": async (raw, context) => {
      const { caseId, patch } = contracts["case.update"].input.parse(raw);
      if (caseId !== context.caseId || context.actorRole !== "subject")
        throw new CaseFileError("access_denied");
      return createCaseFileService(requireDatabase(deps), context.userId).update(
        caseId,
        patch,
        false,
      );
    },
  };
}
