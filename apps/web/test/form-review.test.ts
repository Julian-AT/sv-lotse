// @vitest-environment jsdom

import type { ReviewedField } from "@lotse/brain/forms/registry/schema";
import { ViewerInstanceSchema } from "@lotse/brain/forms/viewer/schema";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createElement, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { FormReview } from "../src/features/form-viewer/form-review.tsx";
import { ReviewOverlay } from "../src/features/form-viewer/review-overlay.tsx";

vi.mock("../src/features/form-viewer/pdf.ts", () => ({
  renderFormPage: () => ({ done: Promise.resolve(), cancel: () => {} }),
}));
// Test-only administrative widget, independent of benefit/scenario data.
const field: ReviewedField = {
  id: "field-a",
  label_de: "Name",
  type: "text",
  owner: "applicant",
  box: { page: 1, x: 10, y: 20, width: 100, height: 30 },
};

const size = { width: 400, height: 600 };
const instanceId = "358f7746-7510-4ecf-95e5-b7a23af607be";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function OverlayHarness() {
  const [fields, setFields] = useState([field]);
  const [selected, setSelected] = useState<string | null>(null);
  return createElement(ReviewOverlay, {
    page: 1,
    size,
    fields,
    selected,
    confirmed: new Set<string>(),
    drawing: false,
    language: "en",
    onSelect: setSelected,
    onChange: (updated) => setFields([updated]),
    onAdd: () => field,
  });
}

test("FR-D11 keyboard arrows move, Shift resizes and boxes stay on the page", () => {
  const view = render(createElement(OverlayHarness));
  const button = screen.getByRole("button", { name: "Name" });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "ArrowRight" });
  const box = button.parentElement;
  expect(box?.style.left).toBe("2.75%");
  fireEvent.keyDown(button, { key: "ArrowDown", shiftKey: true });
  expect(Number.parseFloat(box?.style.height ?? "")).toBeCloseTo((31 / 600) * 100, 4);
  fireEvent.keyDown(screen.getByRole("button", { name: "Resize: Name" }), { key: "ArrowRight" });
  expect(box?.style.width).toBe("25.25%");
  for (let index = 0; index < 50; index++) fireEvent.keyDown(button, { key: "ArrowLeft" });
  expect(box?.style.left).toBe("0%");
  expect(view.container.querySelector("[data-selected]")).toBe(box);
});

function enablePointer(element: HTMLElement): void {
  vi.stubGlobal("PointerEvent", MouseEvent);
  element.setPointerCapture = vi.fn();
}

test("FR-D11 pointer drag and resize use page points at the current zoom", () => {
  const view = render(createElement(OverlayHarness));
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("Missing overlay");
  root.getBoundingClientRect = () => new DOMRect(0, 0, 200, 300);
  const button = screen.getByRole("button", { name: "Name" });
  enablePointer(button);
  fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(button, { clientX: 30, clientY: 35 });
  fireEvent.pointerUp(button);
  expect(button.parentElement?.style.left).toBe("12.5%");
  const resize = screen.getByRole("button", { name: "Resize: Name" });
  enablePointer(resize);
  fireEvent.pointerDown(resize, { button: 0, clientX: 30, clientY: 35 });
  fireEvent.pointerMove(resize, { clientX: 40, clientY: 45 });
  fireEvent.pointerUp(resize);
  expect(button.parentElement?.style.width).toBe("30%");
});

test("FR-D11 drawing a box works in either direction and preserves its page", () => {
  const onChange = vi.fn();
  const onAdd = vi.fn((box) => ({ ...field, box }));
  const view = render(
    createElement(ReviewOverlay, {
      page: 2,
      size,
      fields: [],
      selected: null,
      confirmed: new Set<string>(),
      drawing: true,
      language: "en",
      onSelect: vi.fn(),
      onChange,
      onAdd,
    }),
  );
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("Missing overlay");
  root.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
  const surface = screen.getByRole("button", { name: "Drag a field on the page" });
  enablePointer(surface);
  fireEvent.pointerDown(surface, { button: 0, clientX: 150, clientY: 200 });
  fireEvent.pointerMove(surface, { clientX: 50, clientY: 100 });
  fireEvent.pointerUp(surface);
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ box: { page: 2, x: 50, y: 100, width: 100, height: 100 } }),
  );
});

const instance = ViewerInstanceSchema.parse({
  id: instanceId,
  templateId: instanceId,
  caseId: instanceId,
  subjectId: instanceId,
  title: "Form",
  schema: { fields: [{ ...field, signature: "none" }] },
  fields: {},
});

const pdf = {
  numPages: 1,
  getPage: async () => ({ pageNumber: 1, getViewport: () => size, getAnnotations: async () => [] }),
} as unknown as PDFDocumentProxy;

test("FR-D11 saving requires per-field confirmation and edits revoke that confirmation", async () => {
  const onSaved = vi.fn();
  const fetchReview = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchReview);
  render(
    createElement(FormReview, {
      instance,
      document: pdf,
      zoom: 1,
      language: "en",
      onSaved,
      onCancel: vi.fn(),
    }),
  );
  const save = screen.getByRole("button", { name: "Save reviewed template" });
  await screen.findByRole("button", { name: "Name" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Confirm field" }));
  expect(save.hasAttribute("disabled")).toBe(false);
  fireEvent.keyDown(screen.getByRole("button", { name: "Name" }), { key: "ArrowRight" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Owner section"), { target: { value: "office" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm field" }));
  fireEvent.click(save);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const request = fetchReview.mock.calls[0]?.[1];
  expect(JSON.parse(request.body)).toMatchObject({
    formInstanceId: instanceId,
    fields: [{ id: field.id, owner: "office", box: { x: 11 } }],
  });
  expect(fetchReview.mock.calls[0]?.[0]).toBe(`/api/forms/templates/${instanceId}`);
});

test("FR-D11 keyboard users can add and label every supported field type and see save errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
  render(
    createElement(FormReview, {
      instance,
      document: pdf,
      zoom: 1,
      language: "en",
      onSaved: vi.fn(),
      onCancel: vi.fn(),
    }),
  );
  await screen.findByRole("button", { name: "Name" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm field" }));
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "New section field" } });
  for (const type of ["text", "date", "number", "checkbox", "choice", "signature"]) {
    fireEvent.change(screen.getByLabelText("Field type"), { target: { value: type } });
    expect((screen.getByLabelText("Field type") as HTMLSelectElement).value).toBe(type);
  }
  fireEvent.click(screen.getByRole("button", { name: "Confirm field" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed template" })),
  );
  expect(screen.getByRole("alert").textContent).toContain("could not be saved");
});
