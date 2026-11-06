// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ pages: 2 }));
// Isolated view-state test; real PDF bytes and storage are covered in the browser suite.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: fixture.pages }), destroy: vi.fn() }),
}));
vi.mock("../src/features/viewer/pdf-page.tsx", () => ({ PdfPage: () => null }));

import { DocumentViewer } from "../src/features/viewer/document-viewer.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("opening another document resets the page instead of retaining an invalid page number", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ pages: [] })),
  );
  const props = {
    language: "de" as const,
    onClose: vi.fn(),
    selection: { documentId: "first", caseId: "case" },
  };
  const view = render(createElement(DocumentViewer, props));
  await waitFor(() => expect(screen.getByText("Seite 1 / 2")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));
  expect(screen.getByText("Seite 2 / 2")).toBeDefined();
  fixture.pages = 1;
  view.rerender(
    createElement(DocumentViewer, {
      ...props,
      selection: { documentId: "second", caseId: "case" },
    }),
  );
  await waitFor(() => expect(screen.getByText("Seite 1 / 1")).toBeDefined());
  expect(screen.queryByRole("alert")).toBeNull();
});
