// @vitest-environment jsdom
import type { Action } from "@lotse/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { stopFormFilling } from "../src/features/form-viewer/config.ts";
import type { FormViewerProps } from "../src/features/form-viewer/form-viewer.tsx";
import {
  dispatchFormAction,
  FormViewerWorkspace,
  presentFormGroupApproval,
} from "../src/features/form-viewer/workspace.tsx";

const seen = vi.hoisted(() => vi.fn());
vi.mock("../src/features/form-viewer/form-viewer.tsx", async () => {
  const { useEffect } = await import("react");
  return {
    FormViewer: (props: FormViewerProps) => {
      seen(props);
      useEffect(() => {
        for (const action of props.actions ?? [])
          props.onActionResult?.({
            actionId: action.id,
            success: true,
            resolvedBy: "ui",
            confidence: 1,
          });
      }, [props.actions, props.onActionResult]);
      return null;
    },
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function formAction(): Action {
  return {
    id: crypto.randomUUID(),
    kind: "type",
    sentenceIndex: 0,
    target: { kind: "form", formInstanceId: crypto.randomUUID(), fieldId: "name" },
    payload: {
      value: "Ada",
      pace: 100,
      provenance: { source: { kind: "statement", quote: "Ada" } },
    },
  };
}

test("FR-D5 a streamed action waits for the prepared viewer to mount and is executed once", async () => {
  const action = formAction();
  if (action.target.kind !== "form") throw new Error("Fixture target missing");
  const first = dispatchFormAction(action);
  const duplicate = dispatchFormAction(action);
  render(
    createElement(FormViewerWorkspace, {
      formInstanceId: action.target.formInstanceId,
      language: "en",
    }),
  );
  await expect(first).resolves.toMatchObject({ actionId: action.id, success: true });
  await expect(duplicate).resolves.toMatchObject({ actionId: action.id, success: true });
  expect(seen.mock.lastCall?.[0].actions).toHaveLength(1);
});

test("FR-D5 stop cancels an action even before the viewer mounts", async () => {
  const action = formAction();
  const result = dispatchFormAction(action);
  stopFormFilling();
  await expect(result).resolves.toMatchObject({ success: false, failureReason: "USER_STOPPED" });
});

test("FR-D5 a closed viewer times out with an actual failure", async () => {
  vi.useFakeTimers();
  const result = dispatchFormAction(formAction());
  await vi.runAllTimersAsync();
  await expect(result).resolves.toMatchObject({
    success: false,
    failureReason: "FORM_VIEWER_CLOSED",
  });
});

test("FR-D5 a pending group is presented only to its viewer and disappears after the SDK decision", async () => {
  const id = crypto.randomUUID();
  const input = {
    formInstanceId: id,
    fieldIds: ["name"],
    values: { name: "Ada" },
    context: {
      approvalId: "approval",
      toolCallId: "call",
      toolName: "form.commitGroup",
      caseId: crypto.randomUUID(),
      inputHash: "0".repeat(64),
      summary: "Review",
      provenance: [],
    },
  };
  render(createElement(FormViewerWorkspace, { formInstanceId: id, language: "en" }));
  let dismiss = (): void => {};
  await act(async () => {
    dismiss = presentFormGroupApproval(input, vi.fn());
  });
  expect(seen.mock.lastCall?.[0].approval).toEqual(input);
  await act(async () => dismiss());
  expect(seen.mock.lastCall?.[0].approval).toBeUndefined();
});
