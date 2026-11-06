import type { UIMessageChunk } from "ai";
import type { RetrievedPassage } from "./citations.ts";
import { GUARD_CONFIG } from "./config.ts";
import { guardCopy, guardLocale } from "./copy.ts";
import { extractCitedClaims } from "./references.ts";
import type { GuardedResponse, ResponseGuardInput } from "./response.ts";

/** Per-step buffering preserves the SDK checkpoint order and checks cross-delta speech acts. */
export function createGuardedTextBuffer(
  guard: (input: ResponseGuardInput) => Promise<GuardedResponse>,
  write: (
    chunk: Extract<UIMessageChunk, { type: "text-start" | "text-delta" | "text-end" }>,
  ) => void,
  context: {
    language?: string | undefined;
    userText?: string | undefined;
    signal?: AbortSignal | undefined;
    administrativeOnly?: boolean | undefined;
    passages?: RetrievedPassage[];
  },
): { accept: (chunk: UIMessageChunk) => boolean; flush: () => Promise<void> } {
  let text = "";
  let id: string | undefined;
  let overflow = false;
  return {
    accept(chunk) {
      if (
        chunk.type === "reasoning-start" ||
        chunk.type === "reasoning-delta" ||
        chunk.type === "reasoning-end"
      )
        return true;
      if (chunk.type === "text-start") {
        id ??= chunk.id;
        return true;
      }
      if (chunk.type === "text-delta") {
        id ??= chunk.id;
        if (text.length + chunk.delta.length > GUARD_CONFIG.maxResponseCharacters) overflow = true;
        else text += chunk.delta;
        return true;
      }
      return chunk.type === "text-end";
    },
    async flush() {
      if (id === undefined) return;
      const passages = context.passages ?? [];
      const claims = extractCitedClaims(text, passages);
      const result = overflow
        ? { text: guardCopy[guardLocale(context.language)].handoff }
        : await guard({ text, claims, ...context });
      write({ type: "text-start", id });
      write({ type: "text-delta", id, delta: result.text });
      write({ type: "text-end", id });
      id = undefined;
      text = "";
      overflow = false;
    },
  };
}
