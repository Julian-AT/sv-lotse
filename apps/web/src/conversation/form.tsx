"use client";

import type { LotseMessage } from "@lotse/brain";
import type { ApprovalContext } from "@lotse/protocol";
import { getToolName, isToolUIPart } from "ai";
import { FileTextIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type JSX, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
const DIALOG_MARGIN_PX = 12;
const DIALOG_MIN_HEIGHT_PX = 220;
/** From this chat width on, the form docks beside the chat; narrower, it floats as a capped popup. */
const DOCK_MIN_WIDTH_PX = 1100;
/**
 * Sizing that must hold even if a hot-reloaded page misses generated classes (the Mac app's web
 * view did): without it the panel took its content's width and pushed the close button off-screen.
 */
const DOCKED_STYLE = {
  flex: "0 0 56%",
  width: "56%",
  maxWidth: "56%",
  minWidth: 0,
  height: "100%",
};
const POPUP_STYLE = { width: "calc(100% - 2rem)", maxWidth: "42rem", minWidth: 0 };
/** Share of the space above the reply area the narrow popup may take; the rest shows the chat. */
const POPUP_SHARE = 0.6;

function useWidth(element: Element | null | undefined): number | undefined {
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    if (!element) return;
    const measure = (): void => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);
  return width;
}

/** Top of the reply chips and composer: the narrow popup ends well above it. */
function useReplyAreaTop(surface: Element | null | undefined, active: boolean): number | undefined {
  const [top, setTop] = useState<number>();
  useEffect(() => {
    if (!active || !surface) return;
    const area = (): Element | null => surface.querySelector("[data-chat-reply-area]");
    const measure = (): void => {
      const tops = [...(area()?.children ?? [])]
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.height > 0)
        .map((rect) => rect.top);
      setTop(tops.length ? Math.min(...tops) : undefined);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    const element = area();
    if (element) observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [surface, active]);
  return top;
}

/** Keeps the latest assistant message in view when the form opens or changes its layout. */
function scrollChatToEnd(surface: Element | null | undefined): () => void {
  const scroll = (): void => {
    const log = surface?.querySelector('[role="log"]');
    log?.scrollTo({ top: log.scrollHeight });
  };
  const frame = requestAnimationFrame(scroll);
  const timer = setTimeout(scroll, 260);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

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
  dock,
}: {
  messages: LotseMessage[];
  language: "de" | "en";
  contexts: ApprovalContext[];
  onApprovalDecision: ApprovalResponder;
  /**
   * The chat surface's form slot. The form always renders into it, so switching between the
   * docked panel and the narrow popup never remounts the viewer and its running live fill.
   * `null` while the slot mounts; omitted, the form floats over the page as a popup.
   */
  dock?: HTMLElement | null | undefined;
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
  const surface = dock?.parentElement;
  const surfaceWidth = useWidth(surface);
  const docked = surfaceWidth !== undefined && surfaceWidth >= DOCK_MIN_WIDTH_PX;
  const replyTop = useReplyAreaTop(surface, open && !docked);
  // biome-ignore lint/correctness/useExhaustiveDependencies: docking reflows the chat, so re-scroll
  useEffect(() => {
    if (open && id) return scrollChatToEnd(surface);
  }, [open, id, docked, surface]);
  if (!id) return null;
  const surfaceTop = surface?.getBoundingClientRect().top ?? 0;
  const maxHeight =
    replyTop === undefined
      ? undefined
      : Math.max(
          DIALOG_MIN_HEIGHT_PX,
          Math.round((replyTop - surfaceTop - 2 * DIALOG_MARGIN_PX) * POPUP_SHARE),
        );
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
      {dock !== null && (
        <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
          <DialogPrimitive.Portal forceMount container={dock}>
            <DialogPrimitive.Content
              forceMount
              aria-describedby={undefined}
              data-docked={docked || undefined}
              onInteractOutside={(event) => event.preventDefault()}
              onOpenAutoFocus={(event) => event.preventDefault()}
              style={{
                ...(docked ? DOCKED_STYLE : { ...POPUP_STYLE, top: DIALOG_MARGIN_PX, maxHeight }),
                overflow: "hidden",
                ...(open ? {} : { display: "none" }),
              }}
              className={cn(
                "chatbot-root flex min-w-0 flex-col overflow-hidden bg-background text-foreground data-[state=closed]:hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200",
                docked
                  ? "relative h-full shrink-0 border-l border-border data-[state=open]:slide-in-from-right-4"
                  : "fixed left-1/2 z-50 max-h-[calc(100dvh-1.5rem)] -translate-x-1/2 rounded-xl border border-border shadow-2xl data-[state=open]:slide-in-from-top-2",
              )}
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
      )}
    </>
  );
}
