// @vitest-environment jsdom
import type { LotseMessage } from "@lotse/brain";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { ToolResultCards } from "../src/conversation/results.tsx";
import {
  messageCitations,
  passageDates,
  toolCitations,
  uniqueCitations,
} from "../src/conversation/sources.ts";

afterEach(cleanup);
// Synthetic tool outputs isolate rendering. Real catalog outputs are tested in the brain against Postgres.
const asOf = "2026-10-01";
const source = (path: string, quote: string) => ({
  url: `https://example.org/${path}`,
  quote,
  asOf,
});
const benefit = {
  id: "test-benefit",
  title: "Administrative test benefit",
  description: "Administrative description",
  scope: "state",
  sources: [source("overview", "Overview quote")],
  criteria: [
    {
      id: "residence",
      status: "met",
      text: "Residence is confirmed.",
      legalBasis: "§ 1 Test Act (SozDok, in force since 2026-01-01)",
      sources: [source("residence", "Residence quote")],
    },
    {
      id: "income",
      status: "unknown",
      text: "Income below the published limit.",
      sources: [source("income", "Income quote")],
    },
    {
      id: "age",
      status: "not_met",
      text: "Published age group.",
      sources: [source("age", "Age quote")],
    },
  ],
};
function message(toolName: string, output: unknown, input: unknown = {}): LotseMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName,
        toolCallId: crypto.randomUUID(),
        state: "output-available",
        input,
        output,
      },
    ],
  };
}
function renderCards(value: LotseMessage, language: "de" | "en" = "de"): HTMLElement {
  return render(
    createElement(ToolResultCards, { message: value, language, subjectId: "test-subject" }),
  ).container;
}

test("FR-G2 groups each candidate's criteria into met, unknown and not met with a source chip", () => {
  renderCards(message("catalog.findBenefits", [benefit]));
  expect(screen.getByRole("heading", { name: benefit.title })).toBeTruthy();
  expect(screen.getByText("Land, außerhalb der Sozialversicherung")).toBeTruthy();
  for (const [label, criterion] of [
    ["Erfüllt (1)", benefit.criteria[0]],
    ["Noch offen (1)", benefit.criteria[1]],
    ["Nicht erfüllt (1)", benefit.criteria[2]],
  ] as const) {
    const group = screen.getByRole("region", { name: label });
    expect(within(group).getByText(criterion?.text ?? "")).toBeTruthy();
    expect(within(group).getByRole("link").getAttribute("href")).toBe(criterion?.sources[0]?.url);
  }
  expect(
    screen.getByText(`Rechtsgrundlage: ${benefit.criteria[0]?.legalBasis}`, { exact: false }),
  ).toBeTruthy();
});

test("FR-G4 Warum? opens a Why panel with source, legal basis, as-of date, confidence and unknowns", () => {
  renderCards(message("catalog.findBenefits", [benefit]));
  const why = screen.getByRole("button", { name: `Warum? ${benefit.title}` });
  expect(why.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("region", { name: "Warum?" })).toBeNull();
  fireEvent.click(why);
  expect(why.getAttribute("aria-expanded")).toBe("true");
  const panel = screen.getByRole("region", { name: "Warum?" });
  expect(within(panel).getByText("Overview quote")).toBeTruthy();
  expect(within(panel).getByText("Residence quote")).toBeTruthy();
  expect(within(panel).getByText(benefit.criteria[0]?.legalBasis ?? "")).toBeTruthy();
  expect(within(panel).getAllByText(asOf).length).toBeGreaterThan(0);
  expect(
    within(panel).getByText("Erfüllt: 1 von 3 Kriterien. Noch offen: 1. Nicht erfüllt: 1."),
  ).toBeTruthy();
  expect(within(panel).getByRole("listitem").textContent).toBe(benefit.criteria[1]?.text);
});

test("FR-G2 withholds unsourced or unsafe candidates while keeping valid ones", () => {
  const unsafe = {
    ...benefit,
    id: "unsafe",
    title: "Unsafe candidate",
    sources: [{ ...source("x", "x"), url: "javascript:alert(1)" }],
  };
  const unsourced = {
    ...benefit,
    id: "unsourced",
    title: "Unsourced candidate",
    criteria: [{ ...benefit.criteria[0], sources: [] }],
  };
  renderCards(message("catalog.findBenefits", [unsafe, unsourced, benefit]));
  expect(screen.queryByText(unsafe.title)).toBeNull();
  expect(screen.queryByText(unsourced.title)).toBeNull();
  expect(screen.getByRole("heading", { name: benefit.title })).toBeTruthy();
  cleanup();
  const pending: LotseMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "catalog.findBenefits",
        toolCallId: crypto.randomUUID(),
        state: "input-available",
        input: {},
      },
    ],
  };
  expect(renderCards(pending).childElementCount).toBe(0);
  expect(renderCards({ ...message("catalog.findBenefits", [benefit]), role: "user" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: benefit.title })).toBeNull();
});

test("FR-G4 older results without criterion wording show the verbatim source quote", () => {
  const legacy = {
    ...benefit,
    criteria: [{ id: "legacy", status: "unknown", sources: [source("legacy", "Legacy quote")] }],
  };
  renderCards(message("catalog.findBenefits", [legacy]));
  expect(screen.getByRole("region", { name: "Noch offen (1)" }).textContent).toContain(
    "Legacy quote",
  );
});

test("FR-D9 shows the document checklist with status, where to obtain and a Why panel", () => {
  renderCards(
    message("documents.checklist", [
      {
        type: "test-document",
        title: "Test certificate",
        status: "missing",
        whereToObtain: "Issuing office",
        sources: [source("documents", "Document quote")],
      },
    ]),
  );
  expect(screen.getByText("Test certificate")).toBeTruthy();
  expect(screen.getByText("Fehlt")).toBeTruthy();
  expect(screen.getByText("Issuing office")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Warum? Benötigte Unterlagen" }));
  expect(
    within(screen.getByRole("region", { name: "Warum?" })).getByText("Document quote"),
  ).toBeTruthy();
});

test("FR-M1 shows administrative EKO coverage for the exact named medicine with sources", () => {
  renderCards(
    message(
      "eko.lookupCoverage",
      {
        listed: true,
        box: "yellow_re1",
        approvalRequired: true,
        approvalRequestedBy: "Prescribing doctor",
        conditionsFlag: true,
        prescriptionFee: "Fee text",
        capRule: "Cap text",
        exemptionRule: "Exemption text",
        sources: [source("eko", "EKO quote")],
      },
      { medicineNameExact: "Test medicine" },
    ),
    "en",
  );
  expect(screen.getByRole("heading", { name: "Test medicine" })).toBeTruthy();
  expect(screen.getByText("Listed in the reimbursement code")).toBeTruthy();
  expect(screen.getByText("Yellow box (RE1)")).toBeTruthy();
  expect(screen.getByText("Approval required (Requested by: Prescribing doctor)")).toBeTruthy();
  expect(screen.getByText("Fee text")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Why? Test medicine" }));
  expect(within(screen.getByRole("region", { name: "Why?" })).getByText("EKO quote")).toBeTruthy();
});

test("FR-M2 marks reimbursement amounts as illustrative with their as-of date", () => {
  renderCards(
    message(
      "fees.explainReimbursement",
      {
        ruleText: "Rule text",
        requiredDocuments: ["Invoice"],
        channels: { onlineUrl: "https://example.org/submit" },
        illustrativeAmount: 12.5,
        asOf,
        illustrative: true,
        sources: [source("fees", "Fee quote")],
      },
      { serviceDescription: "Test service" },
    ),
  );
  expect(screen.getByRole("heading", { name: "Test service" })).toBeTruthy();
  expect(screen.getByText("Rule text")).toBeTruthy();
  expect(screen.getByText(/12,50/u)).toBeTruthy();
  expect(screen.getByText("Invoice")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Online einreichen" }).getAttribute("href")).toBe(
    "https://example.org/submit",
  );
  fireEvent.click(screen.getByRole("button", { name: "Warum? Test service" }));
  const panel = screen.getByRole("region", { name: "Warum?" });
  expect(within(panel).getByText("Fee quote")).toBeTruthy();
  expect(within(panel).getByText(/Beispielrechnung/u)).toBeTruthy();
});

test("FR-G4 speech citations take their as-of date from the retrieved passage validity", () => {
  const passage = {
    id: "passage-1",
    text: "Passage text",
    url: "https://example.org/passage",
    validFrom: asOf,
    validTo: null,
  };
  const retrieval = message("kb.search", [passage]);
  const answer: LotseMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "data-speech-segment",
        data: {
          turnId: "test-turn",
          index: 0,
          text: "Sentence.",
          language: "de",
          citations: [{ passageId: passage.id, url: passage.url, quote: passage.text }],
          actionIds: [],
        },
      },
    ],
  };
  expect(messageCitations(answer)[0]?.asOf).toBe("");
  expect(messageCitations(answer, passageDates([retrieval, answer]))[0]?.asOf).toBe(asOf);
  expect(
    messageCitations({ ...answer, parts: [...retrieval.parts, ...answer.parts] })[0]?.asOf,
  ).toBe(asOf);
});

test("FR-G4 tool citations keep legal basis and link imported documents through the session route", () => {
  const [document] = toolCitations([{ url: "document:doc-1#page=2", quote: "Entry", asOf }], {
    key: "k",
    documentTitle: "Your document",
    scope: { subjectId: "subject-1" },
  });
  expect(document).toMatchObject({
    url: "/api/documents/doc-1?subjectId=subject-1#page=2",
    title: "Your document",
    asOf,
  });
  const merged = uniqueCitations([
    ...toolCitations([source("same", "Same quote")], {
      key: "a",
      documentTitle: "",
      legalBasis: "§ 1",
    }),
    ...toolCitations([source("same", "Same quote")], {
      key: "b",
      documentTitle: "",
      legalBasis: "§ 2",
    }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]?.legalBasis).toBe("§ 1; § 2");
});
