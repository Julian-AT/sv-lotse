import { parseBrainConfig } from "../../../config/index.ts";
import { searchKnowledge } from "../../../retrieval/index.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies): Implementations {
  return {
    "kb.search": async (raw, _context, options) => {
      const passages = await searchKnowledge(
        requireDatabase(deps),
        deps.config ?? parseBrainConfig(),
        contracts["kb.search"].input.parse(raw),
        options.abortSignal,
      );
      for (const passage of passages) deps.passages?.set(passage.id, passage);
      return passages;
    },
  };
}
