import { randomUUID } from "node:crypto";
import { extractDatedObligations } from "@lotse/brain/deadlines";
import { describe, expect, test } from "vitest";

// Synthetic administrative obligations: existing data has no dated-obligation envelope.
const factId = randomUUID();
const quote = "Bitte reichen Sie die Unterlagen bis 29.03.2026 ein.";
const fact = {
  id: factId,
  confirmed: true,
  value: { title: "Unterlagen einreichen", dueAt: "2026-03-29" },
  source: { documentId: randomUUID(), page: 1, quote },
};

describe("FR-K2 dated obligations", () => {
  test("extracts only explicit dates from confirmed facts with verbatim provenance", () => {
    const result = extractDatedObligations({ facts: [fact], steps: [] });
    expect(result).toEqual([
      expect.objectContaining({
        key: `fact:${factId}`,
        dueAt: new Date("2026-03-29T21:59:59.999Z"),
        source: expect.objectContaining({
          title: fact.value.title,
          sourceQuote: quote,
          date: "2026-03-29",
          provenance: fact.source,
        }),
      }),
    ]);
  });
});

test.each([
  ["2026-03-28", "2026-03-28T22:59:59.999Z"],
  ["2026-10-25", "2026-10-25T22:59:59.999Z"],
  ["2026-07-01T10:00:00+02:00", "2026-07-01T08:00:00.000Z"],
])("preserves the documented deadline %s without assuming UTC midnight", (dueAt, expected) => {
  const [result] = extractDatedObligations({
    facts: [{ ...fact, value: { ...fact.value, dueAt } }],
    steps: [],
  });
  expect(result?.dueAt.toISOString()).toBe(expected);
});

test("ignores unconfirmed, undated, relative, impossible and unsourced facts", () => {
  const facts = [
    { ...fact, confirmed: false },
    { ...fact, value: "Bitte innerhalb von zwei Wochen antworten." },
    { ...fact, value: { ...fact.value, dueAt: "2026-02-30" } },
    { ...fact, value: { ...fact.value, dueAt: "2026-10-25T02:30:00" } },
    { ...fact, source: { quote: " " } },
  ];
  expect(extractDatedObligations({ facts, steps: [] })).toEqual([]);
});

test("extracts active dated steps with their process quote and ignores completed steps", () => {
  const step = {
    id: randomUUID(),
    status: "pending" as const,
    dueAt: new Date("2026-04-01T08:00:00Z"),
    title: "Nachreichen",
    sourceQuote: quote,
  };
  expect(
    extractDatedObligations({
      facts: [],
      steps: [step, { ...step, id: randomUUID(), status: "completed" }],
    }),
  ).toEqual([
    expect.objectContaining({
      key: `step:${step.id}`,
      dueAt: step.dueAt,
      source: expect.objectContaining({ sourceQuote: quote }),
    }),
  ]);
});
