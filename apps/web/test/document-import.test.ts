// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  DocumentDropZone,
  DocumentUpload,
  useDocumentImport,
} from "../src/conversation/upload.tsx";
import type { Locale } from "../src/i18n/config.ts";
import { I18nProvider } from "../src/i18n/provider.tsx";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    destroy: vi.fn(async () => undefined),
    promise: Promise.resolve({
      numPages: 3,
      getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }),
    }),
  }),
}));
vi.mock("../src/features/form-viewer/pdf.ts", () => ({
  renderFormPage: (page: unknown, canvas: HTMLCanvasElement, zoom: number) => {
    rendered(page, canvas, zoom);
    return { done: Promise.resolve(), cancel: () => undefined };
  },
}));

const subjectId = crypto.randomUUID();
const documentId = crypto.randomUUID();
const letter = (): File =>
  new File([new Uint8Array([37, 80, 68, 70])], "letter.pdf", { type: "application/pdf" });
const photo = (): File => new File([new Uint8Array([137, 80])], "scan.png", { type: "image/png" });

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  rendered.mockReset();
  vi.unstubAllGlobals();
});

function Harness({ onUploaded }: { onUploaded: (id: string) => void }): ReactElement {
  const importer = useDocumentImport({ subjectId, onUploaded });
  return createElement(
    DocumentDropZone,
    { importer },
    createElement("p", null, "Conversation"),
    createElement(DocumentUpload, { importer }),
  );
}

function mount(locale: Locale = "en"): { onUploaded: ReturnType<typeof vi.fn> } {
  const onUploaded = vi.fn();
  render(createElement(I18nProvider, { locale }, createElement(Harness, { onUploaded })));
  return { onUploaded };
}

function stubUpload(response: () => Response): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function dropOnConversation(...files: File[]): void {
  const target = screen.getByText("Conversation");
  const dataTransfer = { files, types: ["Files"], dropEffect: "none" };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

async function preview(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: "Check the document before storing it" });
}

test("FR-D1 a dropped PDF is previewed with page count, page 1 and what will be stored before anything is sent", async () => {
  const fetch = stubUpload(() => Response.json({ documentId, subjectId }, { status: 201 }));
  mount();
  dropOnConversation(letter());
  const dialog = await preview();
  expect(within(dialog).getByText("letter.pdf")).toBeTruthy();
  expect(within(dialog).getByText("PDF")).toBeTruthy();
  expect(await within(dialog).findByText("3 pages")).toBeTruthy();
  const thumbnail = within(dialog).getByRole("img", { name: "Preview of page 1" });
  await waitFor(() => expect(rendered).toHaveBeenCalledWith(expect.anything(), thumbnail, 0.4));
  expect(within(dialog).getByRole("heading", { name: "What will be stored" })).toBeTruthy();
  expect(
    within(dialog).getByText(
      "The file name is not stored. Details from the document are saved only after you confirm them.",
    ),
  ).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

test("FR-D1 cancelling the preview by button or Escape stores nothing", async () => {
  const fetch = stubUpload(() => Response.json({ documentId, subjectId }, { status: 201 }));
  mount();
  dropOnConversation(letter());
  fireEvent.click(within(await preview()).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  dropOnConversation(letter());
  await preview();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(fetch).not.toHaveBeenCalled();
});

test("FR-D1 confirming the preview stores exactly the previewed file once", async () => {
  const fetch = stubUpload(() => Response.json({ documentId, subjectId }, { status: 201 }));
  const { onUploaded } = mount();
  const file = letter();
  dropOnConversation(file);
  fireEvent.click(within(await preview()).getByRole("button", { name: "Store document" }));
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(documentId));
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/documents");
  expect(init.method).toBe("POST");
  const body = init.body as FormData;
  expect(body.get("subjectId")).toBe(subjectId);
  expect(body.get("originClient")).toBe("web");
  expect((body.get("file") as File).name).toBe(file.name);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Document saved. Processing is pending.");
});

test("FR-D1 the keyboard file picker opens the same preview and keeps focus inside it", async () => {
  stubUpload(() => Response.json({ documentId, subjectId }, { status: 201 }));
  mount();
  const picker = screen.getByRole("button", { name: "Upload document" });
  expect(picker.getAttribute("aria-describedby")).toBeTruthy();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("PICKER_MISSING");
  fireEvent.change(input, { target: { files: [photo()] } });
  const dialog = await preview();
  expect(within(dialog).getByText("1 page")).toBeTruthy();
  expect(within(dialog).getByRole("img", { name: "Preview of page 1" }).getAttribute("src")).toBe(
    "blob:preview",
  );
  const close = within(dialog).getByRole("button", { name: "Close" });
  const store = within(dialog).getByRole("button", { name: "Store document" });
  expect(document.activeElement).toBe(close);
  store.focus();
  fireEvent.keyDown(store, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  close.focus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(store);
});

test("FR-D1 a file of an unsupported type never opens a preview", async () => {
  const fetch = stubUpload(() => Response.json({ documentId, subjectId }, { status: 201 }));
  mount("de");
  dropOnConversation(new File(["notes"], "notes.txt", { type: "text/plain" }));
  expect((await screen.findByRole("alert")).textContent).toContain("PDF-, PNG- oder JPEG-Datei");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test("FR-D1 a failed store keeps the preview open with an error so the person can retry or cancel", async () => {
  stubUpload(() => Response.json({ error: "DOCUMENT_UPLOAD_FAILED" }, { status: 503 }));
  const { onUploaded } = mount();
  dropOnConversation(letter());
  const dialog = await preview();
  fireEvent.click(within(dialog).getByRole("button", { name: "Store document" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "The document could not be stored. Please try again.",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(onUploaded).not.toHaveBeenCalled();
});
