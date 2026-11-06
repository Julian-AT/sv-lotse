// @vitest-environment jsdom
import { workspaceSnapshotSchema } from "@lotse/brain/workspace/schema";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { workspaceCopy } from "../src/features/workspace/copy.ts";
import { CaseJourney } from "../src/features/workspace/journey.tsx";
import { RemindersPanel } from "../src/features/workspace/reminders.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const caseId = crypto.randomUUID();
const stepId = crypto.randomUUID();
const documentId = crypto.randomUUID();
// Constructed user-owned case state isolates UI behaviour; sourced persistence is tested against Postgres.
const snapshot = workspaceSnapshotSchema.parse({
  cases: [],
  currentCase: {
    id: caseId,
    subjectId: crypto.randomUUID(),
    subjectName: "Testperson",
    title: "Unterlagen organisieren",
    status: "active",
    createdAt: "2026-11-06T08:00:00Z",
  },
  steps: [
    {
      id: stepId,
      title: "Unterlagen prüfen",
      status: "prepared",
      initiatedBy: "pilot",
      owner: "user",
      blocked: false,
    },
    {
      id: crypto.randomUUID(),
      title: "Angaben klären",
      status: "pending",
      owner: "user",
      blocked: true,
    },
    { id: crypto.randomUUID(), title: "Anliegen klären", status: "completed", owner: "user" },
  ],
  events: [],
  documents: [],
  benefits: [],
  selectedBenefitId: null,
  checklist: [],
  facilities: [],
});

const reminders = [
  {
    id: crypto.randomUUID(),
    dueAt: "2027-03-07T22:59:59.999Z",
    source: {
      title: "Unterlagen einreichen",
      sourceQuote: "Bitte bis 07.03.2027 einreichen.",
      date: "2027-03-07",
      provenance: {
        documentId,
        sources: [{ url: "https://example.org/source", quote: "Original quote" }],
      },
    },
  },
];

test("FR-K5 completes only an open ready step through the server and refreshes the journey", async () => {
  const onChange = vi.fn();
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
    Response.json(init?.method === "POST" ? { step: { status: "completed" } } : { reminders: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    createElement(CaseJourney, { snapshot, language: "de", copy: workspaceCopy.de, onChange }),
  );
  expect(screen.getByText("vom Lotsen vorbereitet, wartet auf dich")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Erledigt" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Erledigt" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledWith(
    `/api/cases/${caseId}/steps/${stepId}/complete`,
    expect.objectContaining({ method: "POST", body: "{}" }),
  );
  expect(screen.getByRole("status").textContent).toContain("offenen Schritte wurden aktualisiert");
});

test("FR-K5 keeps failed completions retryable and does not claim a new step was prepared", async () => {
  const onChange = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(null, { status: 409 })
        : Response.json({ reminders: [] }),
    ),
  );
  render(
    createElement(CaseJourney, { snapshot, language: "de", copy: workspaceCopy.de, onChange }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Erledigt" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("nicht abgeschlossen"),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Erledigt" }).hasAttribute("disabled")).toBe(false);
});

test("FR-K2 displays original quotes, due dates and source links with the existing calendar export", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ reminders })),
  );
  render(createElement(RemindersPanel, { caseId, language: "de" }));
  await screen.findByText(reminders[0]?.source.sourceQuote ?? "");
  expect(screen.getByText("2027-03-07").getAttribute("dateTime")).toBe("2027-03-07");
  expect(screen.getByRole("link", { name: "Quelle öffnen" }).getAttribute("href")).toBe(
    "https://example.org/source",
  );
  expect(screen.getByRole("link", { name: "Quelldokument öffnen" }).getAttribute("href")).toBe(
    `/api/documents/${documentId}`,
  );
  expect(screen.getByRole("link", { name: "In Kalender exportieren" }).getAttribute("href")).toBe(
    `/api/reminders/ics?caseId=${caseId}`,
  );
});

test("FR-K2 recovers from a failed reminder request and presents an empty state", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ reminders: [] }));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(RemindersPanel, { caseId, language: "de" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
  await screen.findByText("Keine Erinnerungen für diesen Fall.");
  expect(screen.queryByRole("link", { name: "In Kalender exportieren" })).toBeNull();
});
