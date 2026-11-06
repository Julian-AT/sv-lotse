import { expect, test } from "vitest";
import { retryUserText } from "../src/conversation/retry.ts";

test("retry repeats only the most recent user text, without replaying assistant tools or IDs", () => {
  expect(
    retryUserText([
      { id: "first", role: "user", parts: [{ type: "text", text: "Frühere Frage" }] },
      { id: "latest", role: "user", parts: [{ type: "text", text: "  Unterlagen prüfen  " }] },
      { id: "reply", role: "assistant", parts: [{ type: "text", text: "Antwort" }] },
    ]),
  ).toBe("Unterlagen prüfen");
  expect(
    retryUserText([{ id: "reply", role: "assistant", parts: [{ type: "text", text: "Antwort" }] }]),
  ).toBeUndefined();
});
