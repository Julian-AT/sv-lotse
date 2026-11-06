import { randomUUID } from "node:crypto";
import type { UIMessageStreamWriter } from "ai";
import type { LotseMessage } from "../tools/types.ts";
import type { RetrievedPassage } from "./citations.ts";
import type { GuardedResponse, ResponseGuardInput } from "./response.ts";

type Writer = Pick<UIMessageStreamWriter<LotseMessage>, "write">;
/** Tool-produced captions and speech share the same gate as generated prose. */
export function createGuardedDataWriter(
  writer: Writer,
  guard: (input: ResponseGuardInput) => Promise<GuardedResponse>,
  context: {
    userText?: string | undefined;
    language?: string | undefined;
    signal?: AbortSignal | undefined;
    administrativeOnly?: boolean | undefined;
    passages: RetrievedPassage[];
  },
): Writer & { flush: () => Promise<void> } {
  let pending = Promise.resolve();
  return {
    write(part) {
      pending = pending.then(async () => {
        if (part.type === "data-speech-segment") {
          const segment = part.data;
          const checked = await guard({
            ...context,
            text: segment.text,
            language: segment.language,
            claims: segment.citations.length
              ? [{ text: segment.text, citations: segment.citations }]
              : [],
          });
          writer.write({
            ...part,
            data: {
              ...segment,
              text: checked.text,
              citations: checked.disposition === "allow" ? segment.citations : [],
              actionIds: checked.disposition === "allow" ? segment.actionIds : [],
            },
          });
        } else if (
          part.type === "data-action" &&
          part.data.kind !== "type" &&
          part.data.payload.label
        ) {
          const checked = await guard({ ...context, text: part.data.payload.label });
          // Never point at or act on a target whose accompanying instruction was rejected.
          if (checked.disposition === "allow") writer.write(part);
          else {
            const id = randomUUID();
            writer.write({ type: "text-start", id });
            writer.write({ type: "text-delta", id, delta: checked.text });
            writer.write({ type: "text-end", id });
          }
        } else {
          writer.write(part);
        }
      });
    },
    flush: () => pending,
  };
}
