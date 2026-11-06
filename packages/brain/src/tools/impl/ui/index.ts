import { randomUUID } from "node:crypto";
import { ActionSchema } from "@lotse/protocol";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";

const kinds = ["point", "highlight", "annotate", "caption", "openResource"] as const;
export function implementations(deps: ToolDependencies): Implementations {
  return Object.fromEntries(
    kinds.map((kind) => [
      `ui.${kind}`,
      async (raw: unknown, context: Parameters<NonNullable<Implementations["ui.point"]>>[1]) => {
        const { target, ...payload } = contracts["ui.point"].input.parse(raw);
        if (!deps.writer) throw new Error("Action writer is required");
        const action = ActionSchema.parse({
          id: randomUUID(),
          kind,
          target,
          payload,
          sentenceIndex: context.sentenceIndex,
        });
        deps.writer.write({ type: "data-action", data: action });
        return { actionId: action.id };
      },
    ]),
  );
}
