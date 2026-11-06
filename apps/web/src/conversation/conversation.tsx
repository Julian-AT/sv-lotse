"use client";

import type { LotseMessage } from "@lotse/brain";
import type { Fact } from "@lotse/protocol";
import { Button, Heading, Stack, WhyPanel } from "@lotse/ui";
import { type JSX, useEffect, useRef, useState } from "react";
import { ChatHeader } from "@/components/chat/chat-header";
import { Messages } from "@/components/chat/messages";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import { Button as UiButton } from "@/components/ui/button";
import { useI18n } from "../i18n/provider.tsx";
import { extractFacts, loadFacts } from "./api.ts";
import { workspaceLabels } from "./copy.ts";
import { ReviewFact } from "./facts.tsx";
import { ConversationForm } from "./form.tsx";
import { OpenOfferReplies } from "./open-offer.tsx";
import { retryUserText } from "./retry.ts";
import type { CaseSummary, ReviewableFact } from "./schemas.ts";
import { messageCitations, passageDates } from "./sources.ts";
import { DocumentDropZone, type DocumentImport, useDocumentImport } from "./upload.tsx";
import { approvalContexts, useConversation } from "./use-conversation.ts";

export type ConversationStart = { text?: string; file?: File };

/**
 * The template's empty chat before a case exists: greeting, suggestions and composer are usable at
 * once; the first message, suggestion or document creates the case and continues in it.
 */
export function DraftConversation({
  showSidebarToggle,
  starting,
  onStart,
}: {
  showSidebarToggle: boolean;
  starting: boolean;
  onStart: (start: ConversationStart) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const importer: DocumentImport = {
    file: undefined,
    status: "idle",
    disabled: starting,
    choose: (file) => onStart({ file }),
    confirm: async () => {},
    cancel: () => {},
  };
  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden" data-chat-surface="">
      <section
        aria-labelledby="conversation-title"
        className="flex min-w-0 flex-1 flex-col bg-sidebar"
      >
        <ChatHeader level="" showSidebarToggle={showSidebarToggle} title={t("workspace.title")} />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
          <Messages
            busyLabel={t("workspace.busy")}
            contexts={[]}
            greeting={{ title: t("workspace.greeting"), subtitle: t("workspace.empty") }}
            messages={[]}
            onApproval={() => {}}
            onAutonomyDecision={async () => {}}
            passageDates={new Map()}
            status={starting ? "submitted" : "ready"}
            subjectId=""
          />
          <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
            <MultimodalInput
              disabled={starting}
              hasMessages={false}
              importer={importer}
              input={input}
              sendMessage={(text) => {
                if (!text.trim() || starting) return;
                setInput("");
                onStart({ text: text.trim() });
              }}
              setInput={setInput}
              status={starting ? "submitted" : "ready"}
              stop={() => {}}
            />
            <p className="m-0 text-center text-[11px] text-muted-foreground/70">
              {t("workspace.boundary")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Wide windows show the form viewer, facts and Why panel beside the chat (the template's artifact slot). */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1180px)");
    const update = (): void => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

// Chat shell from Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md).
export function Conversation({
  selectedCase,
  initialMessages,
  onSettled,
  showSidebarToggle,
  autoStart,
  onAutoStarted,
}: {
  selectedCase: CaseSummary;
  initialMessages: LotseMessage[];
  onSettled: () => void;
  showSidebarToggle: boolean;
  /** The first message or document from the draft screen, continued once in this new case. */
  autoStart?: ConversationStart | undefined;
  onAutoStarted?: () => void;
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
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !autoStart) return;
    started.current = true;
    onAutoStarted?.();
    if (autoStart.file) importer.choose(autoStart.file);
    if (autoStart.text) {
      chat.clearError();
      void chat.send(autoStart.text);
    }
  }, [autoStart, importer, chat, onAutoStarted]);
  const wide = useWideLayout();
  const status = chat.status;
  const support = (
    <div className="lotse-legacy grid min-w-0 gap-4">
      <ConversationForm
        messages={chat.messages}
        language={i18n.locale === "en" ? "en" : "de"}
        contexts={contexts}
        onApprovalDecision={(decision) => {
          void chat.addToolApprovalResponse(decision);
        }}
      />
      <section aria-labelledby="facts-title" className="grid gap-3">
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
                setProposals((current) => current.filter((proposal) => proposal.id !== fact.id));
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
    </div>
  );
  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden" data-chat-surface="">
      <DocumentDropZone importer={importer} className="flex min-w-0 flex-1">
        <section
          aria-labelledby="conversation-title"
          className="flex min-w-0 flex-1 flex-col bg-sidebar"
        >
          <ChatHeader
            level={t("workspace.level", { level: selectedCase.autonomyLevel })}
            showSidebarToggle={showSidebarToggle}
            title={selectedCase.confirmedGoal || t("workspace.title")}
          />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
            <Messages
              busyLabel={chat.statusLine || t("workspace.busy")}
              contexts={contexts}
              greeting={{ title: t("workspace.greeting"), subtitle: t("workspace.empty") }}
              messages={chat.messages}
              onApproval={(id, approved) => {
                void chat.addToolApprovalResponse({ id, approved });
              }}
              onAutonomyDecision={chat.send}
              onRetry={
                retryText && !awaiting
                  ? () => {
                      chat.clearError();
                      void chat.send(retryText);
                    }
                  : undefined
              }
              passageDates={dates}
              status={status}
              subjectId={selectedCase.subjectId}
            >
              {chat.partial && (
                <p
                  aria-label={t("workspace.partial")}
                  className="m-0 whitespace-pre-wrap pl-10 text-[13px] text-muted-foreground"
                  role="status"
                >
                  {chat.partial}
                </p>
              )}
              {busy && (
                <p className="sr-only" role="status">
                  {t("workspace.busy")}
                </p>
              )}
              {!wide && chat.messages.length > 0 && (
                <div className="border-t border-border/40 pt-6">{support}</div>
              )}
            </Messages>

            <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
              {(chat.error || chat.bridgeError) && (
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2 text-[13px] text-foreground"
                  role="alert"
                >
                  <span>{t("workspace.error")}</span>
                  {chat.error && (
                    <UiButton
                      disabled={awaiting || !retryText}
                      onClick={() => {
                        chat.clearError();
                        if (retryText) void chat.send(retryText);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {t("workspace.retry")}
                    </UiButton>
                  )}
                </div>
              )}
              {!busy && !awaiting && <OpenOfferReplies messages={chat.messages} onReply={submit} />}
              <MultimodalInput
                disabled={awaiting}
                hasMessages={chat.messages.length > 0}
                importer={importer}
                input={input}
                sendMessage={submit}
                setInput={setInput}
                status={status}
                stop={() => void chat.stop()}
              />
              <p className="m-0 text-center text-[11px] text-muted-foreground/70">
                {t("workspace.boundary")}
              </p>
            </div>
          </div>
        </section>
      </DocumentDropZone>
      {wide && (
        <aside className="no-scrollbar w-[380px] shrink-0 overflow-y-auto border-l border-border/40 bg-sidebar p-4">
          {support}
        </aside>
      )}
    </div>
  );
}
