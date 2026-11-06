"use client";

import type { ViewerInstance } from "@lotse/brain/forms/viewer/schema";
import { ApprovalContextSchema } from "@lotse/protocol";
import { ApprovalCard, de, en } from "@lotse/ui";
import { type JSX, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { subscribeFormViewerBridge } from "./bridge.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { fieldCitation } from "./provenance.ts";

export const FormGroupApprovalSchema = z.strictObject({
  context: ApprovalContextSchema.refine((context) => context.toolName === "form.commitGroup"),
  formInstanceId: z.string().min(1),
  fieldIds: z.array(z.string().min(1)).min(1),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type FormGroupApproval = z.infer<typeof FormGroupApprovalSchema>;
export type ApprovalResponder = (decision: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | Promise<void>;

export function formApprovalAnchorId(approvalId: string): string {
  return `form-approval-${approvalId}`;
}

export function FormGroupConfirmation(props: {
  instance: ViewerInstance;
  approval: FormGroupApproval;
  language: FormViewerLanguage;
  respond: ApprovalResponder;
  reload: () => Promise<void>;
  blocked?: boolean;
}): JSX.Element | null {
  const decisionHandler = useRef<((approved: boolean) => void) | null>(null);
  const locked = useRef(false);
  decisionHandler.current = null;
  useEffect(
    () =>
      subscribeFormViewerBridge((message) => {
        if (
          message.type === "ApprovalDecision" &&
          message.payload.approvalId === props.approval.context.approvalId
        )
          decisionHandler.current?.(message.payload.approved);
      }),
    [props.approval.context.approvalId],
  );
  const [chatHost, setChatHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setChatHost(document.getElementById(formApprovalAnchorId(props.approval.context.approvalId)));
  }, [props.approval.context.approvalId]);
  const [pending, setPending] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState(false);
  const parsed = FormGroupApprovalSchema.safeParse(props.approval);
  if (!parsed.success) return null;
  const approval = parsed.data;
  if (
    approval.formInstanceId !== props.instance.id ||
    approval.context.caseId !== props.instance.caseId
  )
    return null;
  const copy = formViewerCopy[props.language];
  const fields = approval.fieldIds.map((id) => ({
    definition: props.instance.schema.fields.find((field) => field.id === id),
    value: props.instance.fields[id],
    id,
  }));
  const stale = fields.some(
    ({ id, value, definition }) => !definition || !value || value.value !== approval.values[id],
  );
  const decide = async (approved: boolean): Promise<void> => {
    if (locked.current || (stale && approved) || answered || props.blocked) return;
    locked.current = true;
    setPending(true);
    setError(false);
    try {
      await props.respond({ id: approval.context.approvalId, approved });
      setAnswered(true);
      await props.reload();
    } catch {
      setError(true);
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  decisionHandler.current = (approved) => {
    void decide(approved);
  };
  const review = (
    <>
      <ApprovalCard
        title={approval.context.summary || copy.confirmation}
        changes={fields.map(
          ({ id, value, definition }) =>
            `${definition?.labels[props.language] ?? definition?.label_de ?? id}: ${String(value?.value ?? "")}`,
        )}
        provenance={fields.flatMap(({ id, value }) =>
          value ? [fieldCitation(id, value.provenance, props.language)] : [],
        )}
        labels={props.language === "de" ? de : en}
        pending={pending || stale || answered || props.blocked === true}
        onApprove={() => {
          void decide(true);
        }}
        onDecline={() => {
          void decide(false);
        }}
      />
      {stale && (
        <>
          <p role="status">{copy.approvalStale}</p>
          <button
            type="button"
            disabled={pending || answered || props.blocked === true}
            onClick={() => {
              void decide(false);
            }}
          >
            {copy.reviewAgain}
          </button>
        </>
      )}
      {error && <p role="alert">{copy.approvalError}</p>}
    </>
  );
  return (
    <>
      {review}
      {chatHost && createPortal(review, chatHost)}
    </>
  );
}
