import type { UIMessage } from "ai";
import { expectTypeOf, it } from "vitest";
import type { LotseDataParts, SpeechSegment } from "../src/index.ts";

type LotseMessage = UIMessage<unknown, LotseDataParts>;
type SpeechPart = Extract<LotseMessage["parts"][number], { type: "data-speech-segment" }>;

it("AC5 uses LotseDataParts as the AI SDK 7 UIMessage data generic", () => {
  expectTypeOf<SpeechPart["data"]>().toEqualTypeOf<SpeechSegment>();
  expectTypeOf<keyof LotseDataParts>().toEqualTypeOf<
    | "speech-segment"
    | "action"
    | "case-event"
    | "safety-notice"
    | "job-progress"
    | "approval-context"
  >();
});
