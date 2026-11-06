import { expect, test } from "vitest";
import { listeningFrom } from "../src/components/chat/native-voice-button.tsx";
import { sentInputKind, speaksAloud } from "../src/conversation/use-conversation.ts";

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

test("reply chips keep a spoken conversation spoken; typing makes it silent", () => {
  expect(sentInputKind("transcript", true)).toBe("transcript");
  expect(sentInputKind("text", true)).toBe("text");
  expect(sentInputKind("transcript", false)).toBe("text");
});
