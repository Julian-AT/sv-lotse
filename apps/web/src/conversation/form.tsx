"use client";

import type { LotseMessage } from "@lotse/brain";
import type { ApprovalContext } from "@lotse/protocol";
import { getToolName, isToolUIPart } from "ai";
import { FileTextIcon, XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
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
  // The viewer opens as a sheet: by itself for a new form, a live fill or a pending group approval
  // (its listeners must be mounted), and from the "Formular öffnen" button afterwards.
  const [sheet, setSheet] = useState(false);
  const needsViewer = Boolean(serializedApproval);
  useEffect(() => {
    if (id) setSheet(true);
  }, [id]);
  useEffect(() => {
    if (needsViewer) setSheet(true);
  }, [needsViewer]);
  if (!id) return null;
  const copy =
    language === "en"
      ? { open: "Open form", title: "Form", close: "Close form" }
      : { open: "Formular öffnen", title: "Formular", close: "Formular schließen" };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit rounded-full"
        onClick={() => setSheet(true)}
      >
        <FileTextIcon aria-hidden="true" />
        {copy.open}
      </Button>
      {/* Kept mounted (hidden when closed) so live fills and group approvals reach the viewer. */}
      <SheetPrimitive.Root open={sheet} onOpenChange={setSheet} modal={false}>
        <SheetPrimitive.Portal forceMount>
          <SheetPrimitive.Content
            forceMount
            aria-describedby={undefined}
            onInteractOutside={(event) => event.preventDefault()}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="chatbot-root fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-border bg-background shadow-2xl data-[state=closed]:hidden sm:max-w-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full data-[state=open]:duration-300"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
              <SheetPrimitive.Title className="m-0 text-[0.9375rem] font-semibold">
                {copy.title}
              </SheetPrimitive.Title>
              <SheetPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label={copy.close}>
                  <XIcon aria-hidden="true" />
                </Button>
              </SheetPrimitive.Close>
            </div>
            <div className="lotse-legacy min-h-0 flex-1 overflow-y-auto p-4">
              <FormViewerWorkspace key={id} formInstanceId={id} language={language} />
            </div>
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      </SheetPrimitive.Root>
    </>
  );
}
