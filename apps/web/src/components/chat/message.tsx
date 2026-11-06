// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md). The layout, classes and
// elements are the template's; the parts are SV KI-Lotse's (sourced cards, approvals, safety notices).
"use client";

import { workspaceTargets } from "@lotse/brain/workspace/targets";
import type { ApprovalContext } from "@lotse/protocol";
import type { ToolUIPart } from "ai";
import { getToolName, isToolUIPart } from "ai";
import { PhoneIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ApprovalPanel } from "@/conversation/approval-card.tsx";
import { workspaceLabels } from "@/conversation/copy.ts";
import { DEADLINE_TOOLS, DeadlineResults, deadlineResults } from "@/conversation/deadlines.tsx";
import { OfficeResults, officeResults } from "@/conversation/office.tsx";
import { ToolResultCards } from "@/conversation/results.tsx";
import {
  messageCitations,
  type PassageDates,
  provenanceCitations,
} from "@/conversation/sources.ts";
import { toolLabel } from "@/conversation/tool-labels.ts";
import { toolResults } from "@/conversation/tool-results.ts";
import { pendingApprovals } from "@/conversation/use-conversation.ts";
import { AutonomyConfirmation } from "@/features/autonomy/confirmation.tsx";
import { formApprovalAnchorId } from "@/features/form-viewer/approval.tsx";
import { useI18n } from "@/i18n/provider.tsx";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { ToolStep } from "../gen-ui/tool-step";
import { WhyPopover } from "../gen-ui/why-popover";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Progress } from "../ui/progress";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";

/** Tools whose sourced result renders as a card (see conversation/results.tsx and office.tsx). */
const RESULT_TOOLS = new Set([
  "catalog.findBenefits",
  "documents.checklist",
  "eko.lookupCoverage",
  "fees.explainReimbursement",
  "office.resolve",
  ...DEADLINE_TOOLS,
]);

function WaitingText({ label }: { label: string }) {
  return (
    <div className="flex min-h-[calc(0.8125rem*1.65)] min-w-0 items-center text-[0.8125rem] leading-[1.65]">
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
  /** Shimmer text while the answer is pending (a tool status line or "Lotse antwortet …"). */
  busyLabel?: string | undefined;
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
  busyLabel,
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
  const resultIds = new Set(
    isAssistant
      ? [
          ...toolResults(message).map((result) => result.callId),
          ...officeResults(message).map((office) => office.callId),
          ...deadlineResults(message).map((deadline) => deadline.callId),
        ]
      : [],
  );

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
          className={cn("text-[0.8125rem] leading-[1.65]", {
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
      const name = getToolName(toolPart);
      // A sourced result replaces its step line with its card, at the tool's place in the answer.
      const card = resultIds.has(toolPart.toolCallId) ? (
        DEADLINE_TOOLS.has(name) ? (
          <DeadlineResults
            key="deadlines"
            message={message}
            language={language}
            callId={toolPart.toolCallId}
          />
        ) : name === "office.resolve" ? (
          <OfficeResults
            key="office"
            message={message}
            language={language}
            callId={toolPart.toolCallId}
          />
        ) : (
          <ToolResultCards
            key="result"
            message={message}
            language={language}
            subjectId={subjectId}
            labels={labels}
            callId={toolPart.toolCallId}
          />
        )
      ) : null;
      return (
        <div
          className="w-[min(100%,560px)]"
          data-tool-step=""
          key={toolPart.toolCallId}
          id={workspaceTargets.toolRow(toolPart.toolCallId)}
        >
          {card ?? (
            <ToolStep
              state={toolPart.state}
              title={toolLabel(name, language)}
              language={language}
              errorText={toolPart.errorText}
              skeleton={RESULT_TOOLS.has(name)}
            />
          )}
          {approval && <div className="mt-2">{approval}</div>}
        </div>
      );
    }

    if (type === "data-safety-notice")
      return (
        <Alert
          key={part.id ?? `${message.id}-safety`}
          variant="destructive"
          aria-labelledby={`${message.id}-safety-title`}
          className="w-[min(100%,560px)]"
        >
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle id={`${message.id}-safety-title`} role="heading" aria-level={2}>
            {t("workspace.safety")}
          </AlertTitle>
          <AlertDescription className="text-foreground">
            <p className="m-0">{part.data.text}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {part.data.numbers.map((contact) => (
                <Button
                  asChild
                  key={contact.number}
                  size="sm"
                  variant="destructive"
                  className="rounded-full"
                >
                  <a href={`tel:${contact.number.replace(/[^\d+]/gu, "")}`}>
                    <PhoneIcon aria-hidden="true" />
                    <strong>
                      {contact.label} {contact.number}
                    </strong>
                  </a>
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      );

    if (type === "data-job-progress")
      return (
        <Card
          key={part.data.jobId}
          role="status"
          className="w-[min(100%,560px)] gap-2 px-4 py-3 text-[0.8125rem]"
        >
          {part.data.message}
          <Progress value={Math.round(part.data.progress * 100)} aria-label={part.data.message} />
        </Card>
      );

    return null;
  });

  const spoken = !hasText && segments.length > 0 && (
    <MessageContent
      aria-label={isUser ? labels.user : labels.assistant}
      className={cn("text-[0.8125rem] leading-[1.65]", {
        "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
          isUser,
      })}
    >
      <p className="m-0 whitespace-pre-wrap">{segments.map((segment) => segment.text).join(" ")}</p>
    </MessageContent>
  );

  const sources = citations.length > 0 && (
    <WhyPopover
      citations={citations}
      label={labels.why ?? "Warum?"}
      sourcesLabel={labels.sources ?? "Quellen"}
    />
  );

  const cards = isAssistant && (
    <div className="grid w-[min(100%,560px)] min-w-0 gap-3">
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
    <WaitingText label={busyLabel || t("workspace.busy")} />
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
