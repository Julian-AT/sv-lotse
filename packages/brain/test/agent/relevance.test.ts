import { expect, test } from "vitest";
import { irrelevantToolNames } from "../../src/agent/relevance.ts";

test("only topic tools the request does not touch are withheld", () => {
  const excluded = irrelevantToolNames({
    texts: ["Was kostet die Rezeptgebühr 2026?"],
    history: [],
  });
  expect(excluded.has("kb.search")).toBe(false);
  expect(excluded.has("eko.lookupCoverage")).toBe(false);
  expect(excluded.has("ui.offerResource")).toBe(false);
  expect(excluded.has("appointment.search")).toBe(true);
});

test("tools already used in the conversation stay available", () => {
  const excluded = irrelevantToolNames({
    texts: ["Danke"],
    history: [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-appointment.search",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: {},
          },
        ],
      },
    ] as never,
  });
  expect(excluded.has("appointment.search")).toBe(false);
});
