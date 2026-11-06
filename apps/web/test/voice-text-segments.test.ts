import { expect, test } from "vitest";
import { completedTextSegments } from "../src/voice/text-segments.ts";

test("reads completed text-only replies sentence by sentence without changing their words", () => {
  const segments = completedTextSegments(
    {
      id: "test-message",
      role: "assistant",
      parts: [{ type: "text", text: "Here is the form. You can read it here." }],
    },
    "en",
  );
  expect(segments.map((segment) => segment.text)).toEqual([
    "Here is the form.",
    "You can read it here.",
  ]);
  expect(segments.map((segment) => segment.index)).toEqual([0, 1]);
});
test("never duplicates a reply that contains canonical speech segments", () => {
  const canonical = {
    turnId: "test-turn",
    index: 0,
    text: "Here is the form.",
    language: "en",
    citations: [],
    actionIds: [],
  };
  expect(
    completedTextSegments(
      {
        id: "test-message",
        role: "assistant",
        parts: [
          { type: "text", text: canonical.text },
          { type: "data-speech-segment", data: canonical },
        ],
      },
      "en",
    ),
  ).toEqual([]);
});
