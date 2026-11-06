// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md). The layout, classes and
// elements are the template's; the parts are SV KI-Lotse's (sourced cards, approvals, safety notices).
"use client";

import type { ApprovalContext } from "@lotse/protocol";
import { CitationChip, SafetyNotice } from "@lotse/ui";
import type { ToolUIPart } from "ai";
import { getToolName, isToolUIPart } from "ai";
import type { ReactNode } from "react";
import { ApprovalPanel } from "@/conversation/approval-card.tsx";
import { workspaceLabels } from "@/conversation/copy.ts";
import { OfficeResults } from "@/conversation/office.tsx";
import { ToolResultCards } from "@/conversation/results.tsx";
import {
  messageCitations,
  type PassageDates,
  provenanceCitations,
} from "@/conversation/sources.ts";
import { toolLabel } from "@/conversation/tool-labels.ts";
import { pendingApprovals } from "@/conversation/use-conversation.ts";
import { AutonomyConfirmation } from "@/features/autonomy/confirmation.tsx";
import { formApprovalAnchorId } from "@/features/form-viewer/approval.tsx";
import { useI18n } from "@/i18n/provider.tsx";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../ai-elements/tool";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";

function WaitingText({ label }: { label: string }) {
  return (
    <div className="flex min-h-[calc(13px*1.65)] min-w-0 items-center text-[13px] leading-[1.65]">
      <Shimmer as="span" className="font-medium whitespace-normal break-words" duration={1}>
        {label}
      </Shimmer>
    </div>
  );
}

export type PreviewMessageProps = {
  message: ChatMessage;
  subjectId: string;
  isLoading: boolean;
  /** Last message and not streaming: approvals and autonomy choices are answerable. */
  actionable: boolean;
  contexts: ApprovalContext[];
  passageDates?: PassageDates;
  onApproval: (id: string, approved: boolean) => void;
  onAutonomyDecision: (text: string) => Promise<void>;
  onRetry?: (() => void) | undefined;
};

export const PreviewMessage = ({
  message,
  subjectId,
  isLoading,
  actionable,
  contexts,
  passageDates,
  onApproval,
  onAutonomyDecision,
  onRetry,
}: PreviewMessageProps) => {
  const i18n = useI18n();
  const { t } = i18n;
  const language = i18n.locale === "en" ? "en" : "de";
  const labels = workspaceLabels(i18n);
  const attachmentsFromMessage = message.parts.filter((part) => part.type === "file");

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const segments = message.parts.flatMap((part) =>
    part.type === "data-speech-segment" ? [part.data] : [],
  );
  const hasText = message.parts.some((part) => part.type === "text" && part.text.trim().length > 0);

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" && "text" in part && part.text?.trim().length > 0) ||
      part.type.startsWith("tool-") ||
      part.type === "data-speech-segment",
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div className="flex flex-row justify-end gap-2" data-testid={"message-attachments"}>
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            contentType: attachment.mediaType,
            name: attachment.filename ?? "file",
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
        };
      }
      return acc;
    },
    { isStreaming: false, rendered: false, text: "" },
  ) ?? { isStreaming: false, rendered: false, text: "" };

  const citations = isAssistant ? messageCitations(message, passageDates) : [];
  const approvals = pendingApprovals(message);

  const approvalFor = (toolCallId: string): ReactNode => {
    const approval = approvals.find((entry) => entry.toolCallId === toolCallId);
    if (!approval) return null;
    // The form viewer mirrors its exact-value review here with one shared typing/decision guard.
    if (approval.toolName === "form.commitGroup")
      return actionable || isLoading ? (
        <div id={formApprovalAnchorId(approval.approvalId)} />
      ) : null;
    if (!actionable) return null;
    const context = contexts.find(
      (entry) =>
        entry.approvalId === approval.approvalId &&
        entry.toolCallId === approval.toolCallId &&
        entry.toolName === approval.toolName,
    );
    if (!context) return <p role="status">{t("workspace.approvalLoading")}</p>;
    return (
      <ApprovalPanel
        title={t("workspace.approval")}
        changes={[context.summary]}
        provenance={provenanceCitations(context.provenance, t("workspace.sourceStatement"), {
          subjectId,
        })}
        onApprove={() => onApproval(approval.approvalId, true)}
        onDecline={() => onApproval(approval.approvalId, false)}
        pending={isLoading}
        labels={labels}
      />
    );
  };

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          aria-label={isUser ? labels.user : labels.assistant}
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          {isUser ? (
            <p className="m-0 whitespace-pre-wrap">{part.text}</p>
          ) : (
            <div aria-live="polite" aria-atomic="false" aria-relevant="additions text">
              <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
            </div>
          )}
        </MessageContent>
      );
    }

    if (isToolUIPart(part)) {
      const toolPart = part as ToolUIPart;
      const approval = approvalFor(toolPart.toolCallId);
      return (
        <div className="w-[min(100%,450px)]" key={toolPart.toolCallId}>
          <Tool className="w-full" defaultOpen={toolPart.state === "approval-requested"}>
            <ToolHeader
              state={toolPart.state}
              title={toolLabel(getToolName(toolPart), language)}
              type={toolPart.type}
            />
            <ToolContent>
              {toolPart.input !== undefined && <ToolInput input={toolPart.input} />}
              {(toolPart.state === "output-available" || toolPart.state === "output-error") && (
                <ToolOutput errorText={toolPart.errorText} output={toolPart.output} />
              )}
            </ToolContent>
          </Tool>
          {approval && <div className="mt-2">{approval}</div>}
        </div>
      );
    }

    if (type === "data-safety-notice")
      return (
        <SafetyNotice
          key={part.id ?? `${message.id}-safety`}
          title={t("workspace.safety")}
          text={part.data.text}
          contacts={part.data.numbers}
        />
      );

    if (type === "data-job-progress")
      return (
        <div
          key={part.data.jobId}
          role="status"
          className="grid w-[min(100%,450px)] gap-2 rounded-md border px-3 py-2.5 text-[13px]"
        >
          {part.data.message}
          <progress
            className="h-1.5 w-full accent-foreground"
            value={part.data.progress}
            max={1}
            aria-label={part.data.message}
          />
        </div>
      );

    return null;
  });

  const spoken = !hasText && segments.length > 0 && (
    <MessageContent
      aria-label={isUser ? labels.user : labels.assistant}
      className={cn("text-[13px] leading-[1.65]", {
        "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
          isUser,
      })}
    >
      <p className="m-0 whitespace-pre-wrap">{segments.map((segment) => segment.text).join(" ")}</p>
    </MessageContent>
  );

  const sources = citations.length > 0 && (
    <ul
      aria-label={labels.sources}
      className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-xs"
      data-testid="message-sources"
    >
      {citations.map((source) => (
        <li key={source.id}>
          <CitationChip source={source} />
        </li>
      ))}
    </ul>
  );

  const cards = isAssistant && (
    <div className="lotse-legacy grid min-w-0 gap-3">
      <OfficeResults message={message} language={language} />
      <ToolResultCards
        message={message}
        language={language}
        subjectId={subjectId}
        labels={labels}
      />
      <AutonomyConfirmation
        message={message}
        language={language}
        active={actionable}
        onDecision={onAutonomyDecision}
      />
    </div>
  );

  const actions = (hasText || spoken) && (
    <MessageActions
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onRetry={onRetry}
    />
  );

  const content = isThinking ? (
    <WaitingText label={t("workspace.busy")} />
  ) : (
    <>
      {attachments}
      {spoken}
      {parts}
      {sources}
      {cards}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]",
      )}
      data-role={message.role}
      data-speaker={isUser ? "user" : "assistant"}
      data-testid={`message-${message.role}`}
      id={`message-${message.id}`}
    >
      {[...new Set(segments.map((segment) => segment.turnId))].map((turnId) => (
        <span key={turnId} id={`turn-${turnId}`} />
      ))}
      <div className={cn(isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3")}>
        {isAssistant && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={13} />
            </div>
          </div>
        )}
        {isAssistant ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">{content}</div>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const ThinkingMessage = ({ label }: { label: string }) => (
  <div
    className="group/message w-full"
    data-role="assistant"
    data-testid="message-assistant-loading"
  >
    <div className="flex items-start gap-3">
      <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
        <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
          <SparklesIcon size={13} />
        </div>
      </div>
      <WaitingText label={label} />
    </div>
  </div>
);
