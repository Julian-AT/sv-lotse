// @vitest-environment jsdom
import { createGuide } from "@lotse/guide";
import type { Action } from "@lotse/protocol";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function fieldAction(): Action {
  return {
    id: "fill",
    kind: "type",
    sentenceIndex: 0,
    target: { kind: "ui", elementId: "name" },
    payload: { value: "Ada", pace: 1, provenance: { source: { kind: "statement", quote: "Ada" } } },
  };
}

test("FR-D5 stable workspace UI ids resolve through the real guide for highlighting and approved typing", async () => {
  // JSDOM has no layout engine; provide only geometry, keeping the real guide and input events.
  for (const element of [document.documentElement, document.body]) {
    element.style.opacity = "1";
    element.style.overflowX = "visible";
    element.style.overflowY = "visible";
  }
  const input = document.createElement("input");
  input.id = "name";
  input.setAttribute("aria-label", "Name");
  input.style.opacity = "1";
  input.getBoundingClientRect = () => new DOMRect(20, 20, 180, 44);
  input.getClientRects = () => [input.getBoundingClientRect()] as unknown as DOMRectList;
  document.body.append(input);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const guide = createGuide({ allowlist: [window.location.origin] });
  try {
    const action = fieldAction();
    expect(await guide.execute({ ...action, kind: "highlight", payload: {} })).toMatchObject({
      success: true,
    });
    expect(await guide.execute(action)).toMatchObject({ success: true });
    expect(input.value).toBe("Ada");
  } finally {
    guide.dispose();
  }
});

test("FR-A1 UI ids cannot bypass the guided portal's approval gate", async () => {
  const guide = createGuide({ allowlist: [window.location.origin], bookingPages: [] });
  try {
    expect(await guide.execute(fieldAction())).toMatchObject({
      success: false,
      failureReason: "approval-required",
    });
  } finally {
    guide.dispose();
  }
});
