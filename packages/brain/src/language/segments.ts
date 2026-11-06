import { type SpeechSegment, SpeechSegmentSchema } from "@lotse/protocol";
import type { ProfileSettings } from "./settings.ts";

/** Splitting never rewrites quotes, numbers, form values or the selected register. */
export function createSpeechSegmenter(
  turnId: string,
  settings: ProfileSettings,
  emit: (segment: SpeechSegment) => void,
  initialIndex = 0,
): { push: (text: string) => void; flush: () => void } {
  const language = settings.language === "de" ? "de-AT" : "en";
  const segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
  let buffer = "";
  let index = initialIndex;
  const send = (text: string): void => {
    if (!text.trim()) return;
    emit(
      SpeechSegmentSchema.parse({
        turnId,
        index: index++,
        text: text.trim(),
        language,
        citations: [],
        actionIds: [],
      }),
    );
  };
  return {
    push: (text) => {
      buffer += text;
      const sentences = [...segmenter.segment(buffer)];
      // Keep the trailing fragment until another sentence or text-end confirms it.
      for (const sentence of sentences.slice(0, -1)) send(sentence.segment);
      buffer = sentences.at(-1)?.segment ?? "";
    },
    flush: () => {
      for (const sentence of segmenter.segment(buffer)) send(sentence.segment);
      buffer = "";
    },
  };
}
