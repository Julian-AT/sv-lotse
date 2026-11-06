import { createObjectStorage } from "@lotse/db/storage/s3";
import { createHandoffService } from "../../../case-file/handoff.ts";
import { CaseFileError } from "../../../case-file/schema.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "handoff.compose": async (raw, context) => {
      const input = contracts["handoff.compose"].input.parse(raw);
      if (input.caseId !== context.caseId || context.actorRole !== "subject")
        throw new CaseFileError("access_denied");
      if (!deps.db) throw new CaseFileError("operation_failed");
      const storage = deps.storage ?? createObjectStorage();
      try {
        return await createHandoffService(requireDatabase(deps), storage, context.userId).compose(
          input.caseId,
          input.scope,
          false,
        );
      } finally {
        if (!deps.storage && "close" in storage && typeof storage.close === "function")
          storage.close();
      }
    },
  };
}
