// @vitest-environment jsdom
import type { Action } from "@lotse/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { createClientRuntime } from "../src/conversation/client-tools.ts";

const guide = vi.hoisted(() => ({
  execute: vi.fn(async (action: Action) => ({
    actionId: action.id,
    resolvedBy: "ui",
    success: true,
    confidence: 1,
  })),
  clear: vi.fn(),
  dispose: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@lotse/guide", () => ({ createGuide: () => guide, toCapsulePage: vi.fn() }));
vi.mock("../src/features/form-viewer/workspace.tsx", () => ({
  dispatchFormAction: vi.fn(),
  formViewerMounted: () => false,
}));

afterEach(() => {
  delete window.webkit;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const point = (target: Action["target"]): Action => ({
  id: "point-1",
  kind: "point",
  sentenceIndex: 0,
  target,
  payload: { label: "Hier" },
});

function nativeBridge() {
  const postMessage = vi.fn();
  window.webkit = { messageHandlers: { lotse: { postMessage } } };
  Element.prototype.scrollIntoView = vi.fn();
  return postMessage;
}

test("Mac: a workspace card gets the native cursor via TargetRect and a resolvable action", async () => {
  const posted = nativeBridge();
  document.body.innerHTML = '<section id="benefit-card">Pflegegeld</section>';
  const runtime = createClientRuntime();
  await runtime.action(point({ kind: "ui", elementId: "benefit-card" }));
  runtime.clear();
  const messages = posted.mock.calls.map(([message]) => message);
  expect(messages[0]).toMatchObject({ type: "TargetRect", payload: { targetId: "point-1" } });
  expect(messages.at(-1)).toMatchObject({
    type: "Action",
    payload: { id: "point-1", kind: "point", target: { kind: "ui", elementId: "point-1" } },
  });
  expect(guide.execute).not.toHaveBeenCalled();
});

test("Mac: a sentence on the workspace page is found by its quote", async () => {
  const posted = nativeBridge();
  document.body.innerHTML =
    "<main><p>Den Antrag stellen Sie bei der <b>Pensionsversicherung</b>.</p></main>";
  const runtime = createClientRuntime();
  await runtime.action(
    point({ kind: "text", quote: "Antrag stellen Sie bei der Pensionsversicherung" }),
  );
  runtime.clear();
  expect(posted.mock.calls[0]?.[0]).toMatchObject({ type: "TargetRect" });
});

test("Mac: targets outside the workspace go to the native side unchanged", async () => {
  const posted = nativeBridge();
  const target = { kind: "dom" as const, handle: "h1", url: "https://portal.example.at/antrag" };
  await createClientRuntime().action(point(target));
  expect(posted).toHaveBeenCalledTimes(1);
  expect(posted.mock.calls[0]?.[0]).toMatchObject({ type: "Action", payload: { target } });
});

test("browser: the in-page cursor points without a native bridge", async () => {
  document.body.innerHTML = '<section id="benefit-card">Pflegegeld</section>';
  await createClientRuntime().action(point({ kind: "ui", elementId: "benefit-card" }));
  expect(guide.execute).toHaveBeenCalledWith(
    expect.objectContaining({ target: { kind: "ui", elementId: "benefit-card" } }),
  );
});
