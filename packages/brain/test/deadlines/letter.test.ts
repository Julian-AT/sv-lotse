import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { allowedToolNames } from "../../src/agent/permissions.ts";
import {
  dateOccursInQuote,
  explainLetterAnalysis,
  groundLetterAnalysis,
  type LetterAnalysis,
  readLetterPages,
} from "../../src/deadlines/letter.ts";
import { buildTools } from "../../src/tools/registry.ts";

// Constructed administrative letter, not a real user's document. Covers dates absent in SV-Box.
const action = "Bitte reichen Sie die fehlenden Unterlagen bis 07.03.2027 ein.";
const relative = "Antworten Sie innerhalb von zwei Wochen nach Zustellung.";
const next = "Nach Erhalt prüfen wir die Unterlagen.";
const pages = [{ page: 2, text: `${action}\n${relative}\n${next}` }];
const analysis: LetterAnalysis = {
  kind: "administrative",
  summary: { text: "Die Stelle bittet um fehlende Unterlagen.", quote: action, page: 2 },
  requiredActions: [{ text: "Reichen Sie die fehlenden Unterlagen ein.", quote: action, page: 2 }],
  deadlines: [
    { title: "Unterlagen einreichen", dueAt: "2027-03-07", quote: action, page: 2 },
    { title: "Antworten", dueAt: null, quote: relative, page: 2 },
  ],
  nextSteps: [{ text: "Danach prüft die Stelle Ihre Unterlagen.", quote: next, page: 2 }],
};

describe("FR-D8 plain-language administrative letters", () => {
  test("keeps action, deadline and next-step quotes verbatim with page references", () => {
    const result = explainLetterAnalysis(randomUUID(), groundLetterAnalysis(analysis, pages));
    expect(result.requiredActions[0]?.quote).toBe(action);
    expect(result.deadlines[0]).toMatchObject({ dueAt: "2027-03-07", quote: action, page: 2 });
    expect(result.nextSteps[0]?.quote).toBe(next);
    expect(result.notice).toContain("keine Rechtsberatung");
    expect(result.notice).toContain("Medizinische Inhalte werden nicht erklärt");
  });
  test("rejects invented and cross-page quotes instead of returning partial explanations", () => {
    expect(() =>
      groundLetterAnalysis(
        { ...analysis, summary: { text: "Summary", quote: "invented", page: 2 } },
        pages,
      ),
    ).toThrow("ungrounded_letter");
    expect(() =>
      groundLetterAnalysis(analysis, [{ text: `${action}\n${relative}\n${next}`, page: 1 }]),
    ).toThrow("ungrounded_letter");
    expect(() =>
      groundLetterAnalysis(
        { ...analysis, summary: { text: "Summary", quote: `${action}${next}`, page: 2 } },
        pages,
      ),
    ).toThrow("ungrounded_letter");
  });
  test("never turns a relative deadline or an unquoted model date into a reminder date", () => {
    const result = groundLetterAnalysis(
      {
        ...analysis,
        deadlines: [{ title: "Antworten", quote: relative, page: 2, dueAt: "2027-03-21" }],
      },
      pages,
    );
    expect(result.deadlines[0]?.dueAt).toBeNull();
  });
  test("does not explain non-administrative documents", () => {
    expect(
      groundLetterAnalysis(
        { kind: "unsupported", summary: null, requiredActions: [], deadlines: [], nextSteps: [] },
        pages,
      ).kind,
    ).toBe("unsupported");
    expect(() => groundLetterAnalysis({ ...analysis, kind: "unsupported" }, pages)).toThrow(
      "ungrounded_letter",
    );
  });
  test("accepts stored OCR page formats without inventing text for pending OCR", () => {
    expect(readLetterPages([{ text: action, lines: [] }])).toEqual([{ page: 1, text: action }]);
    expect(readLetterPages(pages)).toEqual(pages);
    expect(() => readLetterPages([])).toThrow("document_not_ready");
    expect(() => readLetterPages([{ lines: [] }])).toThrow("document_not_ready");
    expect(() => readLetterPages([pages[0], pages[0]])).toThrow("document_not_ready");
  });
});

test.each(["7.3.2027", "07.03.2027", "07.3.2027", "7. 03. 2027", "2027-03-07"])(
  "recognizes only an explicit printed date %s",
  (date) => {
    expect(dateOccursInQuote("2027-03-07", `Bitte bis ${date} einreichen.`)).toBe(true);
    expect(dateOccursInQuote("2027-03-07", "Bitte bis 17.03.2027 einreichen.")).toBe(false);
  },
);

test("registers real deadline tools even when stubs are disabled and excludes helpers", () => {
  const tools = buildTools({ allowStubs: false });
  for (const name of [
    "reminder.create",
    "reminder.list",
    "reminder.extract",
    "docs.explainLetter",
  ] as const) {
    expect(tools[name].execute).toBeTypeOf("function");
    expect(allowedToolNames("L1", "subject")).toContain(name);
    expect(allowedToolNames("L3", "helper")).not.toContain(name);
  }
});
