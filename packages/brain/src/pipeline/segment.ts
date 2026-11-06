import {
  type Action,
  ActionSchema,
  type SpeechSegment,
  SpeechSegmentSchema,
} from "@lotse/protocol";
import type { UIMessageChunk, UIMessageStreamWriter } from "ai";
import type { RuntimeContext } from "../agent/context.ts";
import type { BrainConfig } from "../config/index.ts";
import { guardCopy, guardLocale } from "../guards/copy.ts";
import { checkBoundaryRules } from "../guards/rules.ts";
import type { Passage } from "../retrieval/index.ts";
import type { LotseMessage } from "../tools/types.ts";
import { copyFor } from "./copy.ts";
import { citationIds, guardAnswer } from "./guards.ts";

export function segmentAnswer(
  text: string,
  turnId: string,
  language: string,
  passages: ReadonlyMap<string, Passage>,
  start = 0,
  actions: Action[] = [],
): SpeechSegment[] {
  // Attach citation markers following punctuation to that sentence before splitting.
  const normalized = text.replace(
    /([.!?])\s*((?:\[passage:[^\]]+\]\s*)+)/gu,
    (_match: string, punctuation: string, markers: string) => `${markers.trim()}${punctuation} `,
  );
  const sentences = [
    ...new Intl.Segmenter(language, { granularity: "sentence" }).segment(normalized),
  ]
    .map((item) => item.segment.trim())
    .filter(Boolean);
  return sentences.map((sentence, offset) => {
    const index = start + offset;
    return SpeechSegmentSchema.parse({
      turnId,
      index,
      language,
      text: sentence
        .replace(/\[passage:[^\]]+\]/gu, "")
        .replace(/\s+([.!?,;:])/gu, "$1")
        .replace(/[ \t]{2,}/gu, " ")
        .trim(),
      citations: [...new Set(citationIds(sentence))].flatMap((id) => {
        const passage = passages.get(id);
        return passage ? [{ passageId: id, url: passage.url, quote: passage.text }] : [];
      }),
      actionIds: actions
        .filter((action) => action.sentenceIndex === index)
        .map((action) => action.id),
    });
  });
}
export interface SegmentWriter {
  segments: SpeechSegment[];
  emit: (id: string, text: string) => void;
  action: (action: Action) => void;
  write: (part: UIMessageChunk) => Promise<boolean>;
  /**
   * Verifies all buffered text before emitting it. `alsoCheck` runs concurrently with the answer
   * guard and may return a replacement (a rejection copy or a repaired candidate); a repaired
   * candidate is re-checked by the answer guard before it is emitted.
   */
  finish: (alsoCheck?: (text: string) => Promise<string | undefined>) => Promise<void>;
  /** An unopened resource was offered: the reply becomes only the short "open it?" question. */
  offer: (label: string) => void;
  /** This turn continues after a page was opened on request. */
  opened: () => void;
}
export function createSegmentWriter(options: {
  writer: Pick<UIMessageStreamWriter<LotseMessage>, "write">;
  context: RuntimeContext;
  turnId: string;
  language: string;
  config: BrainConfig;
  passages: Map<string, Passage>;
  abortSignal?: AbortSignal;
  onSpeech?: () => void;
  onGuard?: (durationMs: number) => void;
}): SegmentWriter {
  const texts = new Map<string, string>();
  const actions: Action[] = [];
  const segments: SpeechSegment[] = [];
  const completed: { id: string; text: string; actions: Action[] }[] = [];
  let nextIndex = options.context.sentenceIndex;
  let offered: string | undefined;
  let opened = false;
  const emit = (id: string, text: string): void => {
    const pending = actions
      .splice(0)
      .map((action) => ActionSchema.parse({ ...action, sentenceIndex: nextIndex }));
    const speech = segmentAnswer(
      text,
      options.turnId,
      options.language,
      options.passages,
      nextIndex,
      pending,
    );
    options.writer.write({ type: "text-start", id });
    options.writer.write({
      type: "text-delta",
      id,
      delta: speech.map((segment) => segment.text).join(" "),
    });
    options.writer.write({ type: "text-end", id });
    if (speech.length) options.onSpeech?.();
    for (const segment of speech) {
      options.writer.write({ type: "data-speech-segment", data: segment });
      for (const action of pending.filter((item) => item.sentenceIndex === segment.index))
        options.writer.write({ type: "data-action", data: action });
    }
    segments.push(...speech);
    nextIndex += speech.length;
    options.context.sentenceIndex = nextIndex;
  };
  return {
    segments,
    emit,
    action: (action: Action): void => {
      actions.push(ActionSchema.parse(action));
    },
    opened: (): void => {
      opened = true;
    },
    offer: (label: string): void => {
      offered = label.replace(/[?.!\s]+$/u, "").trim();
    },
    finish: async (alsoCheck?: (text: string) => Promise<string | undefined>): Promise<void> => {
      if (offered && checkBoundaryRules(offered).length === 0) {
        // Fixed copy plus the resource name: one short question, no unsourced claims to verify.
        actions.push(...completed.flatMap((item) => item.actions));
        completed.length = 0;
        emit(options.turnId, copyFor(options.language).openOffer(offered));
        return;
      }
      const original = completed.map((item) => item.text).join("\n");
      const trailing = actions.splice(0);
      const allActions = [...completed.flatMap((item) => item.actions), ...trailing];
      const inspected = [
        original,
        ...allActions.flatMap((action) =>
          "label" in action.payload && action.payload.label ? [action.payload.label] : [],
        ),
      ].join("\n");
      const started = performance.now();
      const answerGuard = (text: string): Promise<string> =>
        guardAnswer(options.config, text, options.language, options.passages, options.abortSignal);
      const [checked, replacement] = await Promise.all([
        answerGuard(inspected),
        original.trim() && alsoCheck ? alsoCheck(original) : Promise.resolve(undefined),
      ]);
      let verdict = checked;
      if (checked === inspected && replacement !== undefined && replacement !== original) {
        // A replacement drops the original prose and its actions; it passes the answer guard too.
        verdict = await answerGuard(replacement);
      }
      options.onGuard?.(performance.now() - started);
      actions.length = 0;
      if (verdict !== inspected) {
        // An unsourced claim loses its text, not its pointer: the cursor still shows the place.
        // Medical handoffs drop every action.
        const handoff =
          verdict === copyFor(options.language).handoff ||
          verdict === guardCopy[guardLocale(options.language)].handoff ||
          checkBoundaryRules(inspected).length > 0;
        if (!handoff) actions.push(...allActions);
        // Right after opening a page, an unsourced explanation becomes a short claim-free line.
        const text = !handoff && opened ? copyFor(options.language).opened : verdict;
        emit(completed[0]?.id ?? options.turnId, text);
      } else {
        // All text is verified after the loop. Preserve the following-sentence binding
        // recorded while consuming each text part; never dispatch before verification.
        for (const [index, item] of completed.entries()) {
          actions.push(...item.actions);
          if (index === completed.length - 1) actions.push(...trailing);
          emit(item.id, item.text);
        }
      }
      completed.length = 0;
    },
    write: async (part: UIMessageChunk): Promise<boolean> => {
      if (part.type === "start-step") {
        // Planning prose from tool steps is not the final answer. Keep their display actions.
        actions.push(...completed.flatMap((item) => item.actions));
        completed.length = 0;
        texts.clear();
        return false;
      }
      if (part.type === "text-start") {
        texts.set(part.id, "");
        return true;
      }
      if (part.type === "text-delta") {
        texts.set(part.id, (texts.get(part.id) ?? "") + part.delta);
        return true;
      }
      if (part.type === "text-end") {
        completed.push({ id: part.id, text: texts.get(part.id) ?? "", actions: actions.splice(0) });
        texts.delete(part.id);
        return true;
      }
      return false;
    },
  };
}
