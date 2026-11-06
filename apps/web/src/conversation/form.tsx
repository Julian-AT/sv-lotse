"use client";

import type { LotseMessage } from "@lotse/brain";
import type { ApprovalContext } from "@lotse/protocol";
import { getToolName, isToolUIPart } from "ai";
import { FileTextIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type JSX, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  type ApprovalResponder,
  FormGroupApprovalSchema,
} from "../features/form-viewer/approval.tsx";
import {
  FormViewerWorkspace,
  presentFormGroupApproval,
  refreshFormViewer,
} from "../features/form-viewer/workspace.tsx";
import { OPEN_RESOURCE_CONFIG } from "./open-resource.ts";

const instanceOutput = z.object({ formInstanceId: z.uuid() });

export function conversationFormId(messages: LotseMessage[]): string | undefined {
  for (const message of messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (
        !isToolUIPart(part) ||
        part.state !== "output-available" ||
        getToolName(part) !== "form.prefill"
      )
        continue;
      const parsed = instanceOutput.safeParse(part.output);
      if (parsed.success) return parsed.data.formInstanceId;
    }
  }
  return;
}

export function ConversationForm({
  messages,
  language,
  contexts,
  onApprovalDecision,
}: {
  messages: LotseMessage[];
  language: "de" | "en";
  contexts: ApprovalContext[];
  onApprovalDecision: ApprovalResponder;
}): JSX.Element | null {
  const [opened, setOpened] = useState<string>();
  useEffect(() => {
    const open = (event: Event): void => {
      if (event instanceof CustomEvent && typeof event.detail === "string") setOpened(event.detail);
    };
    window.addEventListener(OPEN_RESOURCE_CONFIG.openFormEvent, open);
    return () => window.removeEventListener(OPEN_RESOURCE_CONFIG.openFormEvent, open);
  }, []);
  const latest = conversationFormId(messages);
  // A newly prepared form instance replaces one opened on request.
  useEffect(() => {
    if (latest) setOpened(undefined);
  }, [latest]);
  const id = opened ?? latest;
  const respond = useRef(onApprovalDecision);
  respond.current = onApprovalDecision;
  const pending = messages
    .at(-1)
    ?.parts.find(
      (part) =>
        isToolUIPart(part) &&
        part.state === "approval-requested" &&
        getToolName(part) === "form.commitGroup",
    );
  const context =
    pending && isToolUIPart(pending) && pending.state === "approval-requested"
      ? contexts.find(
          (entry) =>
            entry.approvalId === pending.approval.id &&
            entry.toolCallId === pending.toolCallId &&
            entry.toolName === "form.commitGroup",
        )
      : undefined;
  const input =
    pending && isToolUIPart(pending)
      ? z.record(z.string(), z.unknown()).safeParse(pending.input)
      : undefined;
  const approval =
    context && input?.success
      ? FormGroupApprovalSchema.safeParse({ ...input.data, context })
      : undefined;
  const serializedApproval = approval?.success ? JSON.stringify(approval.data) : undefined;
  useEffect(() => {
    if (!serializedApproval) return;
    return presentFormGroupApproval(JSON.parse(serializedApproval), (decision) =>
      respond.current(decision),
    );
  }, [serializedApproval]);
  // Reload persisted field state after an approved group is committed.
  const commits = messages
    .flatMap((message) => message.parts)
    .filter(
      (part) =>
        isToolUIPart(part) &&
        part.state === "output-available" &&
        getToolName(part) === "form.commitGroup",
    ).length;
  const prefills = messages
    .flatMap((message) => message.parts)
    .filter(
      (part) =>
        isToolUIPart(part) &&
        part.state === "output-available" &&
        getToolName(part) === "form.prefill",
    ).length;
  useEffect(() => {
    if (id && (commits > 0 || prefills > 1)) refreshFormViewer(id);
  }, [id, commits, prefills]);
  // The viewer opens as a popup: by itself for a new form, a live fill or a pending group approval
  // (its listeners must be mounted), and from the "Formular öffnen" button afterwards.
  const [open, setOpen] = useState(false);
  const needsViewer = Boolean(serializedApproval);
  useEffect(() => {
    if (id) setOpen(true);
  }, [id]);
  useEffect(() => {
    if (needsViewer) setOpen(true);
  }, [needsViewer]);
  if (!id) return null;
  const copy =
    language === "en"
      ? { open: "Open form", title: "Form" }
      : { open: "Formular öffnen", title: "Formular" };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit rounded-full"
        onClick={() => setOpen(true)}
      >
        <FileTextIcon aria-hidden="true" />
        {copy.open}
      </Button>
      {/* Kept mounted (hidden when closed) so live fills and group approvals reach the viewer. */}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Content
            forceMount
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="chatbot-root fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl data-[state=closed]:hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200"
          >
            <DialogPrimitive.Title className="sr-only">{copy.title}</DialogPrimitive.Title>
            <FormViewerWorkspace
              key={id}
              formInstanceId={id}
              language={language}
              embedded
              onClose={() => setOpen(false)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
