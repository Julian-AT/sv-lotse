import type { LotseDataParts, SpeechSegment } from "@lotse/protocol";
import type { UIMessage } from "ai";

/** Presentation fallback for runtimes that still return text without speech data parts. */
export function completedTextSegments(
  message: UIMessage<unknown, LotseDataParts>,
  language: string,
): SpeechSegment[] {
  if (message.parts.some((part) => part.type === "data-speech-segment")) return [];
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  const actions = message.parts.flatMap((part) => (part.type === "data-action" ? [part.data] : []));
  const sentences = Array.from(
    new Intl.Segmenter(language, { granularity: "sentence" }).segment(text),
  );
  return sentences.flatMap(({ segment }, index) =>
    segment.trim()
      ? [
          {
            turnId: message.id,
            index,
            text: segment.trim(),
            language,
            citations: [],
            actionIds: actions
              .filter((action) => action.sentenceIndex === index)
              .map((action) => action.id),
          },
        ]
      : [],
  );
}
