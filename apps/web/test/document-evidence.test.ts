// @vitest-environment jsdom
import type { FactSource } from "@lotse/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { DocumentEvidence } from "../src/conversation/document-evidence.tsx";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    destroy: vi.fn(async () => undefined),
    promise: Promise.resolve({
      getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }),
    }),
  }),
}));
vi.mock("../src/features/form-viewer/pdf.ts", () => ({
  renderFormPage: () => ({ done: Promise.resolve(), cancel: () => undefined }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const subjectId = crypto.randomUUID();
const source: FactSource = {
  kind: "document",
  documentId: crypto.randomUUID(),
  page: 3,
  bbox: { x: 0.1, y: 0.2, width: 0.6, height: 0.05 },
  quote: "Administrative source quotation",
};

test("FR-D4 highlights the grounded source rectangle on its original authorized PDF page", async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array([1])));
  vi.stubGlobal("fetch", fetch);
  const { container } = render(
    createElement(DocumentEvidence, { source, subjectId, language: "de" }),
  );
  const details = container.querySelector("details");
  if (!details) throw new Error("EVIDENCE_MISSING");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(container.querySelector("mark")).not.toBeNull());
  expect(container.querySelector("mark")?.style.top).toBe("20%");
  expect(fetch).toHaveBeenCalledWith(
    `/api/documents/${source.documentId}?subjectId=${subjectId}`,
    expect.objectContaining({ credentials: "same-origin" }),
  );
  expect(screen.getByText(source.quote ?? "", { selector: "q" })).toBeTruthy();
});

test("FR-D4 never renders a source highlight when the authorized document request fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  const { container } = render(
    createElement(DocumentEvidence, { source, subjectId, language: "de" }),
  );
  const details = container.querySelector("details");
  if (!details) throw new Error("EVIDENCE_MISSING");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByRole("alert");
  expect(container.querySelector("mark")).toBeNull();
});
