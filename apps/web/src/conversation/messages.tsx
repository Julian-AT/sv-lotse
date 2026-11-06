"use client";

import type { LotseMessage } from "@lotse/brain";
import type { ApprovalContext } from "@lotse/protocol";
import { CitationChip, SafetyNotice } from "@lotse/ui";
import { CheckIcon, CopyIcon, RefreshCcwIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Action, Actions } from "@/components/ai-elements/actions.tsx";
import { Message, MessageContent } from "@/components/ai-elements/message.tsx";
import { Response } from "@/components/ai-elements/response.tsx";
import { Shimmer } from "@/components/ai-elements/shimmer.tsx";
import { Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources.tsx";
import {
  Tool,
  ToolCode,
  ToolContent,
  ToolHeader,
  type ToolState,
} from "@/components/ai-elements/tool.tsx";
import { AutonomyConfirmation } from "../features/autonomy/confirmation.tsx";
import { formApprovalAnchorId } from "../features/form-viewer/approval.tsx";
import { useI18n } from "../i18n/provider.tsx";
import { ApprovalPanel } from "./approval-card.tsx";
import { workspaceLabels } from "./copy.ts";
import { OfficeResults } from "./office.tsx";
import { ToolResultCards } from "./results.tsx";
import { messageCitations, type PassageDates, provenanceCitations } from "./sources.ts";
import { toolLabel } from "./tool-labels.ts";
import { pendingApprovals } from "./use-conversation.ts";

interface ToolPartView {
  key: string;
  name: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText?: string;
}

function toolParts(message: LotseMessage): ToolPartView[] {
  return message.parts.flatMap((part, index) => {
    const raw = part as {
      type: string;
      toolName?: string;
      toolCallId?: string;
      state?: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    const dynamic = raw.type === "dynamic-tool";
    if (!dynamic && !raw.type.startsWith("tool-")) return [];
    const name = dynamic ? (raw.toolName ?? "tool") : raw.type.slice("tool-".length);
    const view: ToolPartView = {
      key: raw.toolCallId ?? `${message.id}-tool-${index}`,
      name,
      state: (raw.state ?? "input-available") as ToolState,
      input: raw.input,
      output: raw.output,
    };
    if (raw.errorText) view.errorText = raw.errorText;
    return [view];
  });
}

function CopyAction({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <Action
      label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Action>
  );
}

export function ConversationMessage({
  message,
  subjectId,
  streaming,
  contexts,
  onApproval,
  actionable,
  onAutonomyDecision,
  passageDates,
  onRetry,
}: {
  message: LotseMessage;
  subjectId: string;
  streaming: boolean;
  contexts: ApprovalContext[];
  onApproval: (id: string, approved: boolean) => void;
  actionable: boolean;
  onAutonomyDecision: (text: string) => Promise<void>;
  /** Passage validity dates from the whole conversation; defaults to this message's retrievals. */
  passageDates?: PassageDates;
  /** Regenerates the last answer; shown as an action on the last assistant message. */
  onRetry?: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const language = i18n.locale === "en" ? "en" : "de";
  const labels = workspaceLabels(i18n);
  const segments = message.parts.flatMap((part) =>
    part.type === "data-speech-segment" ? [part.data] : [],
  );
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const reasoning = message.parts
    .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
    .join("\n");
  const shown = text || segments.map((segment) => segment.text).join(" ");
  const citations = messageCitations(message, passageDates);
  const user = message.role === "user";
  const tools = toolParts(message);
  const assistantBody = !user && (reasoning || tools.length > 0 || shown || streaming);
  return (
    <div id={`message-${message.id}`} className="grid min-w-0 gap-3 [&>*]:min-w-0">
      {[...new Set(segments.map((segment) => segment.turnId))].map((turnId) => (
        <span key={turnId} id={`turn-${turnId}`} />
      ))}
      {user && shown && (
        <Message from="user">
          <MessageContent from="user" aria-label={labels.user}>
            <p className="m-0 whitespace-pre-wrap">{shown}</p>
          </MessageContent>
        </Message>
      )}
      {assistantBody && (
        <Message from="assistant">
          {reasoning && (
            <details className="text-[13px] text-muted-foreground">
              <summary className="cursor-pointer">
                {language === "de" ? "Überlegungen" : "Reasoning"}
              </summary>
              <p className="m-0 whitespace-pre-wrap">{reasoning}</p>
            </details>
          )}
          {tools.map((tool) => (
            <Tool key={tool.key} className="w-[min(100%,36rem)]">
              <ToolHeader
                title={toolLabel(tool.name, language)}
                state={tool.state}
                language={language}
              />
              <ToolContent>
                {tool.input !== undefined && (
                  <ToolCode label={language === "de" ? "Eingabe" : "Input"} value={tool.input} />
                )}
                {tool.output !== undefined && (
                  <ToolCode label={language === "de" ? "Ergebnis" : "Result"} value={tool.output} />
                )}
                {tool.errorText && (
                  <p role="alert" className="m-0 text-destructive">
                    {tool.errorText}
                  </p>
                )}
              </ToolContent>
            </Tool>
          ))}
          {shown && (
            <MessageContent
              from="assistant"
              aria-label={labels.assistant}
              data-streaming={streaming || undefined}
            >
              <div aria-live="polite" aria-atomic="false" aria-relevant="additions text">
                <Response>{shown}</Response>
              </div>
            </MessageContent>
          )}
          {streaming && !shown && (
            <div className="flex min-h-[calc(13px*1.65)] items-center text-[13px]">
              <Shimmer>{t("workspace.busy")}</Shimmer>
            </div>
          )}
          {citations.length > 0 && (
            <Sources defaultOpen>
              <SourcesTrigger count={citations.length} label={labels.sources ?? "Quellen"} />
              <SourcesContent>
                <ul aria-label={labels.sources} className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {citations.map((source) => (
                    <li key={source.id}>
                      <CitationChip source={source} />
                    </li>
                  ))}
                </ul>
              </SourcesContent>
            </Sources>
          )}
          {shown && !streaming && (
            <Actions className="-ml-2 opacity-60 transition-opacity group-hover/message:opacity-100">
              <CopyAction text={shown} label={language === "de" ? "Kopieren" : "Copy"} />
              {onRetry && (
                <Action
                  label={language === "de" ? "Erneut beantworten" : "Regenerate"}
                  onClick={onRetry}
                >
                  <RefreshCcwIcon />
                </Action>
              )}
            </Actions>
          )}
        </Message>
      )}
      <div className="grid min-w-0 gap-3 empty:hidden md:pl-10 [&>*]:min-w-0">
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
        {message.parts.map((part) => {
          if (part.type === "data-safety-notice")
            return (
              <SafetyNotice
                key={part.id ?? `${message.id}-safety`}
                title={t("workspace.safety")}
                text={part.data.text}
                contacts={part.data.numbers}
              />
            );
          if (part.type === "data-job-progress")
            return (
              <div
                key={part.data.jobId}
                role="status"
                className="glass grid gap-2 rounded-2xl px-4 py-3 text-sm"
              >
                {part.data.message}
                <progress
                  className="w-full accent-[var(--primary)]"
                  value={part.data.progress}
                  max={1}
                  aria-label={part.data.message}
                />
              </div>
            );
          return null;
        })}
        {pendingApprovals(message).map((approval) => {
          // The viewer mirrors its exact-value review here with one shared typing/decision guard.
          if (approval.toolName === "form.commitGroup" && (actionable || streaming))
            return <div key={approval.approvalId} id={formApprovalAnchorId(approval.approvalId)} />;
          if (!actionable) return null;
          const context = contexts.find(
            (entry) =>
              entry.approvalId === approval.approvalId &&
              entry.toolCallId === approval.toolCallId &&
              entry.toolName === approval.toolName,
          );
          if (!context)
            return (
              <p role="status" key={approval.approvalId}>
                {t("workspace.approvalLoading")}
              </p>
            );
          return (
            <ApprovalPanel
              key={approval.approvalId}
              title={t("workspace.approval")}
              changes={[context.summary]}
              provenance={provenanceCitations(context.provenance, t("workspace.sourceStatement"), {
                subjectId,
              })}
              onApprove={() => onApproval(approval.approvalId, true)}
              onDecline={() => onApproval(approval.approvalId, false)}
              pending={streaming}
              labels={labels}
            />
          );
        })}
      </div>
    </div>
  );
}
