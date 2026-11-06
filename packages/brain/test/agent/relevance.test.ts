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

test("without a confirmed goal only lookups and display tools are offered", () => {
  const excluded = irrelevantToolNames({
    texts: ["Ich möchte das Pflegegeld-Formular ausfüllen."],
    history: [],
    readOnly: true,
  });
  for (const tool of ["process.start", "case.update", "form.prefill", "form.fillLive", "ui.fill"])
    expect(excluded.has(tool as never)).toBe(true);
  for (const tool of ["kb.search", "catalog.findBenefits", "form.find", "ui.offerResource"])
    expect(excluded.has(tool as never)).toBe(false);
  const offering = irrelevantToolNames({ texts: [], history: [], readOnly: true, offering: false });
  expect(offering.has("ui.offerResource")).toBe(true);
  expect(offering.has("kb.search")).toBe(false);
});
