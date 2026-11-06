"use client";

import { type Action, type ActionResult, ActionSchema } from "@lotse/protocol";
import { type JSX, useCallback, useEffect, useState } from "react";
import { CaseConversation } from "@/conversation/case-conversation.tsx";
import { OPEN_RESOURCE_CONFIG } from "@/conversation/open-resource.ts";
import {
  type ApprovalResponder,
  type FormGroupApproval,
  FormGroupApprovalSchema,
} from "./approval.tsx";
import { FORM_FILL_STOP_EVENT, FORM_VIEWER_CONFIG } from "./config.ts";
import type { FormViewerLanguage } from "./copy.ts";
import { FormViewer } from "./form-viewer.tsx";

type ActionListener = (action: Action, result: (value: ActionResult) => void) => void;
type ApprovalListener = (
  approval: FormGroupApproval,
  respond: ApprovalResponder,
) => (() => void) | undefined;
const actionListeners = new Map<string, ActionListener>();
const approvalListeners = new Set<ApprovalListener>();
const awaitingMount = new Map<string, Set<(listener?: ActionListener) => void>>();
const refreshListeners = new Map<string, () => void>();

/** Whether a workspace form viewer for this instance is mounted and receiving actions. */
export function formViewerMounted(formInstanceId: string): boolean {
  return actionListeners.has(formInstanceId);
}

export function refreshFormViewer(formInstanceId: string): void {
  refreshListeners.get(formInstanceId)?.();
}

/** Call from the conversation client's data-action handler. Returns the actual UI outcome. */
export function dispatchFormAction(input: unknown): Promise<ActionResult> {
  const action = ActionSchema.parse(input);
  return new Promise((resolve) => {
    const listener =
      action.target.kind === "form" && action.kind === "type"
        ? actionListeners.get(action.target.formInstanceId)
        : undefined;
    if (!listener && action.target.kind === "form" && action.kind === "type") {
      const id = action.target.formInstanceId;
      const waiters = awaitingMount.get(id) ?? new Set();
      awaitingMount.set(id, waiters);
      const deliver = (mounted?: ActionListener, failureReason = "FORM_VIEWER_CLOSED"): void => {
        clearTimeout(timer);
        window.removeEventListener(FORM_FILL_STOP_EVENT, stop);
        waiters.delete(deliver);
        if (waiters.size === 0) awaitingMount.delete(id);
        if (mounted) mounted(action, resolve);
        else
          resolve({
            actionId: action.id,
            resolvedBy: "ui",
            confidence: 0,
            success: false,
            failureReason,
          });
      };
      const stop = (): void => deliver(undefined, "USER_STOPPED");
      window.addEventListener(FORM_FILL_STOP_EVENT, stop);
      const timer = setTimeout(deliver, FORM_VIEWER_CONFIG.actionMountTimeoutMs);
      waiters.add(deliver);
      return;
    }
    if (!listener) {
      resolve({
        actionId: action.id,
        resolvedBy: "ui",
        confidence: 0,
        success: false,
        failureReason: "FORM_VIEWER_CLOSED",
      });
      return;
    }
    listener(action, resolve);
  });
}

/** Pass addToolApprovalResponse from the conversation client; never create client approvals. */
export function presentFormGroupApproval(input: unknown, respond: ApprovalResponder): () => void {
  const approval = FormGroupApprovalSchema.parse(input);
  const dismiss = [...approvalListeners].map((listener) => listener(approval, respond));
  return () => {
    for (const cleanup of dismiss) cleanup?.();
  };
}

/** Standalone route host. Embedded workspace layouts may render FormViewer directly with props. */
export function FormViewerWorkspace(props: {
  formInstanceId: string;
  language: FormViewerLanguage;
  approval?: FormGroupApproval | undefined;
  onApprovalDecision?: ApprovalResponder | undefined;
  /**
   * Inside the chat the chat already owns the case conversation. A second one would reload it
   * and interrupt the running turn, rejecting its continuation (CONTINUATION_REJECTED).
   */
  embedded?: boolean;
  onClose?: (() => void) | undefined;
}): JSX.Element {
  const [actions, setActions] = useState<Action[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [caseId, setCaseId] = useState<string>();
  const loaded = useCallback(
    (instance: { caseId: string }): void => {
      setCaseId(instance.caseId);
      window.dispatchEvent(
        new CustomEvent(OPEN_RESOURCE_CONFIG.formReadyEvent, { detail: props.formInstanceId }),
      );
    },
    [props.formInstanceId],
  );
  const [approval, setApproval] = useState<{
    request: FormGroupApproval;
    respond: ApprovalResponder;
  }>();
  const [results] = useState(() => new Map<string, Array<(value: ActionResult) => void>>());
  const [completed] = useState(() => new Map<string, ActionResult>());
  useEffect(() => {
    const actionListener: ActionListener = (action, result) => {
      if (action.target.kind !== "form" || action.target.formInstanceId !== props.formInstanceId) {
        result({
          actionId: action.id,
          resolvedBy: "ui",
          confidence: 0,
          success: false,
          failureReason: "FORM_VIEWER_CLOSED",
        });
        return;
      }
      const previousResult = completed.get(action.id);
      if (previousResult) {
        result(previousResult);
        return;
      }
      const pending = results.get(action.id);
      if (pending) {
        pending.push(result);
        return;
      }
      results.set(action.id, [result]);
      setActions((previous) => [...previous, action]);
    };
    const approvalListener: ApprovalListener = (request, respond) => {
      if (request.formInstanceId !== props.formInstanceId) return;
      setApproval({ request, respond });
      return () =>
        setApproval((current) =>
          current?.request.context.approvalId === request.context.approvalId ? undefined : current,
        );
    };
    actionListeners.set(props.formInstanceId, actionListener);
    for (const deliver of awaitingMount.get(props.formInstanceId) ?? []) deliver(actionListener);
    const refresh = (): void => setRefreshVersion((version) => version + 1);
    refreshListeners.set(props.formInstanceId, refresh);
    approvalListeners.add(approvalListener);
    return () => {
      if (actionListeners.get(props.formInstanceId) === actionListener)
        actionListeners.delete(props.formInstanceId);
      approvalListeners.delete(approvalListener);
      if (refreshListeners.get(props.formInstanceId) === refresh)
        refreshListeners.delete(props.formInstanceId);
      for (const [actionId, resolvers] of results)
        for (const resolve of resolvers)
          resolve({
            actionId,
            resolvedBy: "ui",
            confidence: 0,
            success: false,
            failureReason: "FORM_VIEWER_CLOSED",
          });
      results.clear();
      completed.clear();
    };
  }, [props.formInstanceId, results, completed]);
  return (
    <>
      <FormViewer
        formInstanceId={props.formInstanceId}
        language={props.language}
        actions={actions}
        refreshVersion={refreshVersion}
        approval={props.approval ?? approval?.request}
        onApprovalDecision={props.onApprovalDecision ?? approval?.respond}
        onInstanceLoaded={loaded}
        onClose={props.onClose}
        onActionResult={(result) => {
          completed.set(result.actionId, result);
          for (const resolve of results.get(result.actionId) ?? []) resolve(result);
          results.delete(result.actionId);
        }}
      />
      {caseId && !props.onApprovalDecision && !props.embedded && (
        <CaseConversation
          caseId={caseId}
          language={props.language}
          onFormApproval={presentFormGroupApproval}
          onFormUpdated={refreshFormViewer}
        />
      )}
    </>
  );
}
