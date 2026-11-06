"use client";

import type { LotseMessage } from "@lotse/brain";
import type { Fact } from "@lotse/protocol";
import { Button, Heading, Stack, WhyPanel } from "@lotse/ui";
import { type JSX, useEffect, useState } from "react";
import {
  Conversation as AiConversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation.tsx";
import { Loader } from "@/components/ai-elements/loader.tsx";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input.tsx";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button as UiButton } from "@/components/ui/button.tsx";
import { useI18n } from "../i18n/provider.tsx";
import { extractFacts, loadFacts } from "./api.ts";
import { workspaceLabels } from "./copy.ts";
import { ReviewFact } from "./facts.tsx";
import { ConversationForm } from "./form.tsx";
import { ConversationMessage } from "./messages.tsx";
import { OpenOfferReplies } from "./open-offer.tsx";
import { retryUserText } from "./retry.ts";
import type { CaseSummary, ReviewableFact } from "./schemas.ts";
import { messageCitations, passageDates } from "./sources.ts";
import { DocumentDropZone, DocumentUpload, useDocumentImport } from "./upload.tsx";
import { approvalContexts, useConversation } from "./use-conversation.ts";
import styles from "./workspace.module.css";

export function Conversation({
  selectedCase,
  initialMessages,
  onSettled,
}: {
  selectedCase: CaseSummary;
  initialMessages: LotseMessage[];
  onSettled: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const [input, setInput] = useState("");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [proposals, setProposals] = useState<ReviewableFact[]>([]);
  const [factsError, setFactsError] = useState(false);
  const [lastUpload, setLastUpload] = useState<string>();
  const [extracting, setExtracting] = useState(false);
  const settled = (): void => {
    onSettled();
  };
  const chat = useConversation({
    caseId: selectedCase.id,
    language: i18n.locale === "en" ? "en" : "de-AT",
    initialMessages,
    onSettled: settled,
  });
  const importer = useDocumentImport({
    subjectId: selectedCase.subjectId,
    onUploaded: (documentId) => {
      settled();
      void extractUploaded(documentId);
    },
  });
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const last = chat.messages.at(-1);
  const retryText = retryUserText(chat.messages);
  const awaiting =
    last?.parts.some((part) => "state" in part && part.state === "approval-requested") ?? false;
  const contexts = approvalContexts(chat.messages);
  const dates = passageDates(chat.messages);
  const sources = [
    ...new Map(
      chat.messages
        .flatMap((message) => messageCitations(message, dates))
        .map((source) => [source.id, source]),
    ).values(),
  ];
  const refreshFacts = async (): Promise<void> => {
    setFacts(await loadFacts(selectedCase.subjectId, selectedCase.id));
    setFactsError(false);
  };
  async function extractUploaded(documentId: string): Promise<void> {
    setLastUpload(documentId);
    setExtracting(true);
    setFactsError(false);
    try {
      const result = await extractFacts(documentId, selectedCase.subjectId, selectedCase.id);
      setProposals((current) => [...current, ...result]);
      setLastUpload(undefined);
    } catch {
      setFactsError(true);
    } finally {
      setExtracting(false);
    }
  }
  useEffect(() => {
    if (busy) return;
    let active = true;
    void loadFacts(selectedCase.subjectId, selectedCase.id)
      .then((result) => {
        if (active) {
          setFacts(result);
          setFactsError(false);
        }
      })
      .catch(() => {
        if (active) setFactsError(true);
      });
    return () => {
      active = false;
    };
  }, [selectedCase.id, selectedCase.subjectId, busy]);
  const submit = (text: string): void => {
    if (!text.trim() || busy || awaiting) return;
    setInput("");
    chat.clearError();
    void chat.send(text.trim());
  };
  const suggestions =
    i18n.locale === "en"
      ? [
          "My mother needs help at home",
          "I have a discharge letter",
          "Submit an elective doctor bill",
        ]
      : [
          "Meine Mutter braucht Pflege",
          "Ich habe einen Entlassungsbrief",
          "Wahlarzt-Rechnung einreichen",
        ];
  return (
    <div className={styles.columns} data-chat-surface="">
      <DocumentDropZone importer={importer}>
        <section
          aria-labelledby="conversation-title"
          className="relative flex h-[calc(100dvh-9rem)] min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background font-sans text-foreground shadow-[var(--shadow-card)]"
        >
          <header className="glass absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-2 border-b border-border/50 px-4">
            <h2 id="conversation-title" className="m-0 text-sm font-semibold">
              {t("workspace.title")}
            </h2>
            <Badge variant="secondary" className="ml-auto">
              {t("workspace.level", { level: selectedCase.autonomyLevel })}
            </Badge>
          </header>
          <AiConversation className="min-h-0 flex-1">
            <ConversationContent className="pt-20 [overflow-wrap:anywhere]" aria-busy={busy}>
              {chat.messages.length === 0 && (
                <ConversationEmptyState
                  className="pointer-events-none min-h-64 flex-1"
                  title={t("workspace.greeting")}
                  description={t("workspace.empty")}
                />
              )}
              {chat.messages.map((message, index) => (
                <ConversationMessage
                  key={message.id}
                  message={message}
                  subjectId={selectedCase.subjectId}
                  contexts={contexts}
                  passageDates={dates}
                  streaming={busy && index === chat.messages.length - 1}
                  actionable={index === chat.messages.length - 1 && !busy}
                  onAutonomyDecision={chat.send}
                  onApproval={(id, approved) => {
                    void chat.addToolApprovalResponse({ id, approved });
                  }}
                  {...(index === chat.messages.length - 1 &&
                  message.role === "assistant" &&
                  retryText &&
                  !awaiting
                    ? {
                        onRetry: () => {
                          chat.clearError();
                          void chat.send(retryText);
                        },
                      }
                    : {})}
                />
              ))}
              {chat.partial && (
                <p
                  role="status"
                  aria-label={t("workspace.partial")}
                  className="m-0 whitespace-pre-wrap text-muted-foreground md:pl-10"
                >
                  {chat.partial}
                </p>
              )}
              {busy && chat.messages.at(-1)?.role !== "assistant" && (
                <Loader role="status" label={t("workspace.busy")} />
              )}
              {busy && chat.messages.at(-1)?.role === "assistant" && (
                <p role="status" className="sr-only">
                  {t("workspace.busy")}
                </p>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </AiConversation>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2 pb-3 md:px-4 md:pb-4">
            {(chat.error || chat.bridgeError) && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-foreground"
              >
                <span>{t("workspace.error")}</span>
                {chat.error && (
                  <UiButton
                    variant="outline"
                    size="sm"
                    disabled={awaiting || !retryText}
                    onClick={() => {
                      chat.clearError();
                      if (retryText) void chat.send(retryText);
                    }}
                  >
                    {t("workspace.retry")}
                  </UiButton>
                )}
              </div>
            )}
            {!busy && !awaiting && <OpenOfferReplies messages={chat.messages} onReply={submit} />}
            {chat.messages.length === 0 && !busy && (
              <Suggestions>
                {suggestions.map((suggestion) => (
                  <Suggestion
                    key={suggestion}
                    suggestion={suggestion}
                    disabled={awaiting}
                    onClick={submit}
                  />
                ))}
              </Suggestions>
            )}
            <PromptInput
              onSubmit={(event) => {
                event.preventDefault();
                submit(input);
              }}
            >
              <label htmlFor="workspace-message" className="sr-only">
                {t("workspace.message")}
              </label>
              <PromptInputTextarea
                id="workspace-message"
                value={input}
                placeholder={t("workspace.placeholder")}
                onChange={(event) => setInput(event.target.value)}
                disabled={awaiting}
                rows={2}
              />
              <PromptInputToolbar>
                <PromptInputTools>
                  <DocumentUpload importer={importer} compact />
                </PromptInputTools>
                {busy ? (
                  <PromptInputSubmit
                    type="button"
                    status="streaming"
                    aria-label={t("workspace.stop")}
                    onClick={() => void chat.stop()}
                  />
                ) : (
                  <PromptInputSubmit
                    status="ready"
                    aria-label={t("workspace.send")}
                    disabled={awaiting || !input.trim()}
                  />
                )}
              </PromptInputToolbar>
            </PromptInput>
            <p className="m-0 text-center text-[11px] text-muted-foreground">
              {t("workspace.boundary")}
            </p>
          </div>
        </section>
      </DocumentDropZone>
      <div className={styles.support}>
        <ConversationForm
          messages={chat.messages}
          language={i18n.locale === "en" ? "en" : "de"}
          contexts={contexts}
          onApprovalDecision={(decision) => {
            void chat.addToolApprovalResponse(decision);
          }}
        />
        <aside className={styles.sidebar}>
          <section aria-labelledby="facts-title">
            <Heading id="facts-title">{t("workspace.facts")}</Heading>
            {factsError && (
              <>
                <p role="alert">{t("workspace.error")}</p>
                <Button
                  disabled={extracting}
                  onClick={() => {
                    if (lastUpload) void extractUploaded(lastUpload);
                    else void refreshFacts().catch(() => setFactsError(true));
                  }}
                >
                  {t("workspace.retry")}
                </Button>
              </>
            )}
            {!factsError && facts.length === 0 && proposals.length === 0 && (
              <p>{t("workspace.noFacts")}</p>
            )}
            <Stack>
              {[...facts, ...proposals].map((fact) => (
                <ReviewFact
                  key={fact.id}
                  fact={fact}
                  onSaved={async () => {
                    await refreshFacts();
                    setProposals((current) =>
                      current.filter((proposal) => proposal.id !== fact.id),
                    );
                  }}
                />
              ))}
            </Stack>
          </section>
          <WhyPanel
            sources={sources}
            unknowns={sources.length === 0 ? [t("workspace.whyEmpty")] : []}
            labels={workspaceLabels(i18n)}
          />
        </aside>
      </div>
    </div>
  );
}
