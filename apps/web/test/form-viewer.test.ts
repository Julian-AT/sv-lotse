// @vitest-environment jsdom
import {
  isValidFieldValue,
  ViewerFieldSchema,
  ViewerInstanceSchema,
} from "@lotse/brain/forms/viewer/schema";
import type { Action } from "@lotse/protocol";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  FormGroupConfirmation,
  formApprovalAnchorId,
} from "../src/features/form-viewer/approval.tsx";
import {
  measureFieldTarget,
  receiveFormViewerBridgeMessage,
  reportFormTargetRect,
  subscribeFormViewerBridge,
} from "../src/features/form-viewer/bridge.ts";
import { normalizeBounds, transformPoint } from "../src/features/form-viewer/geometry.ts";
import { typeFieldValue } from "../src/features/form-viewer/typing.ts";
import { useLiveFill } from "../src/features/form-viewer/use-live-fill.ts";

// Synthetic administrative fields exercise timing, owner and validation cases independently of catalog content.
const id = "358f7746-7510-4ecf-95e5-b7a23af607be";
const field = ViewerFieldSchema.parse({
  id: "field-a",
  label_de: "Name",
  type: "text",
  owner: "applicant",
  signature: "none",
  box: { page: 1, x: 10, y: 20, width: 100, height: 30 },
  validation: { required: true },
});

const provenance = { source: { kind: "statement" as const, quote: "Ada", turnId: id } };
const payload = { value: "Ada", pace: 100, provenance };
const instance = ViewerInstanceSchema.parse({
  id,
  caseId: id,
  subjectId: id,
  templateId: id,
  title: "Form",
  schema: { fields: [field] },
  fields: { [field.id]: { value: "Ada", provenance, state: "draft", approvalId: null } },
});

const action: Action = {
  id: "action-a",
  kind: "type",
  target: { kind: "form", formInstanceId: id, fieldId: field.id },
  sentenceIndex: 0,
  payload,
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("FR-D5 types at the payload pace and keeps grapheme clusters intact", async () => {
  vi.useFakeTimers();
  const onValue = vi.fn();
  const work = typeFieldValue(
    { ...payload, value: "A\u0308da" },
    { signal: new AbortController().signal, reducedMotion: false, paceMultiplier: 1, onValue },
  );
  expect(onValue).toHaveBeenLastCalledWith("");
  await vi.advanceTimersByTimeAsync(99);
  expect(onValue).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(onValue).toHaveBeenLastCalledWith("A\u0308");
  await vi.advanceTimersByTimeAsync(200);
  await work;
  expect(onValue).toHaveBeenLastCalledWith("A\u0308da");
});

test("FR-L4 abort cancels the next keystroke and reduced motion finishes without timers", async () => {
  vi.useFakeTimers();
  const aborter = new AbortController();
  const onValue = vi.fn();
  const work = typeFieldValue(payload, {
    signal: aborter.signal,
    reducedMotion: false,
    paceMultiplier: 2,
    onValue,
  });
  const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(200);
  expect(onValue).toHaveBeenLastCalledWith("A");
  aborter.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(onValue).toHaveBeenLastCalledWith("A");
  await typeFieldValue(payload, {
    signal: new AbortController().signal,
    reducedMotion: true,
    paceMultiplier: 1,
    onValue,
  });
  expect(onValue).toHaveBeenLastCalledWith("Ada");
  expect(vi.getTimerCount()).toBe(0);
});

test("FR-D5 reports the field before typing, deduplicates actions and Escape cancels queued actions", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const element = document.createElement("div");
  document.body.append(element);
  element.scrollIntoView = vi.fn();
  const results = vi.fn();
  const rects = vi.fn();
  const actions = [action, { ...action, id: "action-b" }];
  const options = {
    instance,
    actions,
    ready: true,
    elements: new Map([[field.id, element]]),
    language: "de" as const,
    slow: false,
    onTargetRect: rects,
    onActionResult: results,
  };
  const { result, rerender } = renderHook((props) => useLiveFill(props), { initialProps: options });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(rects).toHaveBeenCalledTimes(1);
  expect(result.current.preview[field.id]?.value).toBe("A");
  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(results.mock.calls.map(([value]) => value)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actionId: "action-a",
        success: false,
        failureReason: "USER_STOPPED",
      }),
      expect.objectContaining({
        actionId: "action-b",
        success: false,
        failureReason: "USER_STOPPED",
      }),
    ]),
  );
  rerender({ ...options, actions: [...actions] });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(rects).toHaveBeenCalledTimes(1);
  element.remove();
});

test("FR-D5 reserved and signature fields reject fill actions and manual values", async () => {
  const reserved = { ...field, owner: "doctor" as const };
  expect(isValidFieldValue(reserved, "Ada")).toBe(false);
  expect(isValidFieldValue({ ...field, type: "signature" }, "Ada")).toBe(false);
  const onActionResult = vi.fn();
  renderHook(() =>
    useLiveFill({
      instance: { ...instance, schema: { fields: [reserved] } },
      actions: [action],
      ready: true,
      elements: new Map(),
      language: "en",
      slow: false,
      onTargetRect: vi.fn(),
      onActionResult,
    }),
  );
  await act(async () => {});
  expect(onActionResult).toHaveBeenCalledWith(
    expect.objectContaining({ success: false, failureReason: "FIELD_UNAVAILABLE" }),
  );
});

test("FR-D5 maps top-left page points and rotated PDF coordinates without using device pixels", () => {
  expect(
    normalizeBounds({ x: 10, y: 20, width: 50, height: 40 }, { width: 100, height: 200 }),
  ).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.2 });
  expect(transformPoint(10, 20, [0, 1, 1, 0, 0, 0])).toEqual([20, 10]);
  expect(transformPoint(10, 20, [1, 0, 0, -1, 0, 200])).toEqual([10, 180]);
});

test("FR-D5 bridge sends validated TargetRect envelopes in window CSS points and hides detached targets", async () => {
  const postMessage = vi.fn().mockResolvedValue({ accepted: true });
  vi.stubGlobal("webkit", { messageHandlers: { lotse: { postMessage } } });
  const element = document.createElement("div");
  document.body.append(element);
  element.getBoundingClientRect = () => new DOMRect(10, 20, 100, 40);
  const rect = measureFieldTarget(field.id, element);
  await reportFormTargetRect(rect);
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "TargetRect",
      v: "1.0.0",
      payload: expect.objectContaining({
        visible: true,
        rect: { x: 10, y: 20, width: 100, height: 40 },
      }),
    }),
  );
  element.remove();
  expect(measureFieldTarget(field.id, element).visible).toBe(false);
  await expect(reportFormTargetRect({ ...rect, scale: 0 })).rejects.toThrow();
});

test("FR-L4 bridge validates native stop messages and preserves an existing workspace receiver", () => {
  const receiver = { receive: vi.fn() };
  vi.stubGlobal("__lotse", receiver);
  const listener = vi.fn();
  const unsubscribe = subscribeFormViewerBridge(listener);
  receiveFormViewerBridgeMessage({ type: "SpeechControl", payload: { stop: true } });
  expect(listener).not.toHaveBeenCalled();
  receiveFormViewerBridgeMessage({
    v: "1.0.0",
    id,
    type: "SpeechControl",
    payload: { stop: true, state: "idle", segmentIndex: 0 },
  });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(Reflect.get(window, "__lotse")).toBe(receiver);
});

const approval = {
  context: {
    approvalId: "approval-a",
    caseId: id,
    toolCallId: "call-a",
    toolName: "form.commitGroup",
    inputHash: "0".repeat(64),
    summary: "Passt das so?",
    provenance: [provenance],
  },
  formInstanceId: id,
  fieldIds: [field.id],
  values: { [field.id]: "Ada" },
};
test("FR-D5 ApprovalCard emits the SDK decision and waits for server state instead of confirming locally", async () => {
  const respond = vi.fn();
  const reload = vi.fn();
  render(
    createElement(FormGroupConfirmation, { instance, approval, language: "de", respond, reload }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Zustimmen" }));
  await act(async () => {});
  expect(respond).toHaveBeenCalledExactlyOnceWith({
    id: approval.context.approvalId,
    approved: true,
  });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(instance.fields[field.id]?.state).toBe("draft");
});

test("FR-D5 a correction invalidates the visible approval preview", () => {
  const respond = vi.fn();
  render(
    createElement(FormGroupConfirmation, {
      instance,
      approval: { ...approval, values: { [field.id]: "Old" } },
      language: "en",
      respond,
      reload: vi.fn(),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(respond).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("changed");
});

test("FR-L4 native approval decisions use the same stale-value guard as the ApprovalCard", async () => {
  const respond = vi.fn();
  const view = render(
    createElement(FormGroupConfirmation, {
      instance,
      approval,
      language: "en",
      respond,
      reload: vi.fn(),
    }),
  );
  await act(async () =>
    receiveFormViewerBridgeMessage({
      v: "1.0.0",
      id,
      type: "ApprovalDecision",
      payload: { approvalId: approval.context.approvalId, approved: true, via: "voice" },
    }),
  );
  expect(respond).toHaveBeenCalledExactlyOnceWith({
    id: approval.context.approvalId,
    approved: true,
  });
  view.unmount();
  respond.mockClear();
  render(
    createElement(FormGroupConfirmation, {
      instance,
      approval: { ...approval, values: { [field.id]: "Old" } },
      language: "en",
      respond,
      reload: vi.fn(),
    }),
  );
  await act(async () =>
    receiveFormViewerBridgeMessage({
      v: "1.0.0",
      id,
      type: "ApprovalDecision",
      payload: { approvalId: approval.context.approvalId, approved: true, via: "voice" },
    }),
  );
  expect(respond).not.toHaveBeenCalled();
});

test("FR-L4 standalone native receiver is removed after its last subscriber leaves", () => {
  const first = subscribeFormViewerBridge(vi.fn());
  const second = subscribeFormViewerBridge(vi.fn());
  expect(Reflect.get(window, "__lotse")).toBeDefined();
  first();
  expect(Reflect.get(window, "__lotse")).toBeDefined();
  second();
  expect(Reflect.get(window, "__lotse")).toBeUndefined();
});

test("FR-D5 clipped fields report invisible even inside the browser window", () => {
  const container = document.createElement("div");
  container.style.overflow = "hidden";
  const element = document.createElement("div");
  container.append(element);
  document.body.append(container);
  container.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  element.getBoundingClientRect = () => new DOMRect(10, 120, 80, 20);
  expect(measureFieldTarget(field.id, element).visible).toBe(false);
  element.getBoundingClientRect = () => new DOMRect(10, 20, 80, 20);
  expect(measureFieldTarget(field.id, element).visible).toBe(true);
  container.remove();
});

test("FR-D5 group approval waits while the field group is still typing", async () => {
  const respond = vi.fn();
  render(
    createElement(FormGroupConfirmation, {
      instance,
      approval,
      language: "en",
      respond,
      reload: vi.fn(),
      blocked: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await act(async () =>
    receiveFormViewerBridgeMessage({
      v: "1.0.0",
      id,
      type: "ApprovalDecision",
      payload: { approvalId: approval.context.approvalId, approved: true, via: "voice" },
    }),
  );
  expect(respond).not.toHaveBeenCalled();
});

test("FR-D5 chat and viewer mirror exact values with one approval guard during typing", async () => {
  const host = document.createElement("div");
  host.id = formApprovalAnchorId(approval.context.approvalId);
  document.body.append(host);
  const respond = vi.fn();
  const props = {
    instance,
    approval,
    language: "en" as const,
    respond,
    reload: vi.fn(),
    blocked: true,
  };
  const view = render(createElement(FormGroupConfirmation, props));
  expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
  for (const button of screen.getAllByRole("button", { name: "Approve" })) fireEvent.click(button);
  expect(respond).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Name: Ada");
  expect(host.textContent).toContain("Ada");
  view.rerender(createElement(FormGroupConfirmation, { ...props, blocked: false }));
  for (const button of screen.getAllByRole("button", { name: "Approve" })) fireEvent.click(button);
  await act(async () => {});
  expect(respond).toHaveBeenCalledExactlyOnceWith({
    id: approval.context.approvalId,
    approved: true,
  });
  host.remove();
});

test("FR-D5 stopping before PDF readiness prevents delayed typing after load", async () => {
  const onActionResult = vi.fn();
  const options = {
    instance,
    actions: [action],
    ready: false,
    elements: new Map<string, HTMLElement>(),
    language: "en" as const,
    slow: false,
    onTargetRect: vi.fn(),
    onActionResult,
  };
  const { result, rerender } = renderHook((props) => useLiveFill(props), { initialProps: options });
  fireEvent.keyDown(window, { key: "Escape" });
  rerender({ ...options, ready: true });
  await act(async () => {});
  expect(onActionResult).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ actionId: action.id, success: false, failureReason: "USER_STOPPED" }),
  );
  expect(result.current.isFilling).toBe(false);
});

test("FR-D5 keyboard corrections can dismiss a stale group to request a fresh review", async () => {
  const respond = vi.fn();
  render(
    createElement(FormGroupConfirmation, {
      instance,
      approval: { ...approval, values: { [field.id]: "Old" } },
      language: "en",
      respond,
      reload: vi.fn(),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Request a new review" }));
  await act(async () => {});
  expect(respond).toHaveBeenCalledExactlyOnceWith({
    id: approval.context.approvalId,
    approved: false,
  });
});

test("FR-D5 reloads the persisted drafts once typing finishes so filled fields stay visible", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const element = document.createElement("div");
  document.body.append(element);
  element.scrollIntoView = vi.fn();
  const filled = vi.fn();
  const options = {
    instance,
    actions: [action, { ...action, id: "action-b" }],
    ready: true,
    elements: new Map([[field.id, element]]),
    language: "de" as const,
    slow: false,
    onTargetRect: vi.fn(),
    onSettled: filled,
  };
  renderHook((props) => useLiveFill(props), { initialProps: options });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(filled).toHaveBeenCalledTimes(1);
  element.remove();
});
