import { SpeechSegmentSchema } from "@lotse/protocol";
import { expect, test } from "vitest";
import { listeningFrom } from "../src/components/chat/native-voice-button.tsx";
import {
  STATUS_SEGMENT_INDEX,
  speaksAloud,
  statusSpeech,
} from "../src/conversation/use-conversation.ts";

test("the status line becomes a valid native speech segment that never replaces an answer sentence", () => {
  const segment = statusSpeech(
    { turnId: "turn-1", text: "Einen Moment, ich schaue das kurz nach …" },
    "de",
  );
  expect(SpeechSegmentSchema.parse(segment)).toEqual(segment);
  expect(segment.index).toBe(STATUS_SEGMENT_INDEX);
  expect(segment.turnId).toBe("turn-1");
});

test("the mic button reads the native capture state defensively", () => {
  expect(listeningFrom({ listening: true })).toBe(true);
  expect(listeningFrom({ listening: false })).toBe(false);
  expect(listeningFrom(null)).toBeUndefined();
  expect(listeningFrom("yes")).toBeUndefined();
});

test("only voice turns are read aloud; typed turns stay silent", () => {
  expect(speaksAloud("transcript")).toBe(true);
  expect(speaksAloud("text")).toBe(false);
});
