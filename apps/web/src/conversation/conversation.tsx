"use client";

import type { LotseMessage } from "@lotse/brain";
import type { Fact } from "@lotse/protocol";
import { isToolUIPart } from "ai";
import { type JSX, useEffect, useRef, useState } from "react";
import { ChatHeader } from "@/components/chat/chat-header";
import { Messages } from "@/components/chat/messages";
import { MultimodalInput } from "@/components/chat/multimodal-input";
import { Button as UiButton } from "@/components/ui/button";
import { FORM_FILLING_EVENT } from "../features/form-viewer/config.ts";
import { anyFormViewerMounted } from "../features/form-viewer/workspace.tsx";
import { useI18n } from "../i18n/provider.tsx";
import { extractFacts, loadFacts } from "./api.ts";
import { FactsReview } from "./facts.tsx";
import { ConversationForm } from "./form.tsx";
import { OpenOfferReplies } from "./open-offer.tsx";
import { retryUserText } from "./retry.ts";
import type { CaseSummary, ReviewableFact } from "./schemas.ts";
import { passageDates } from "./sources.ts";
import { DocumentDropZone, type DocumentImport, useDocumentImport } from "./upload.tsx";
import { approvalContexts, useConversation } from "./use-conversation.ts";

export type ConversationStart = { text?: string; file?: File };

const QUEUE_GRACE_MS = 1500;

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
        className="flex min-w-0 flex-1 flex-col bg-page-sidebar"
      >
        <ChatHeader showSidebarToggle={showSidebarToggle} title={t("workspace.title")} />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-page md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40 native:md:border-0">
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
          <div className="pointer-events-none sticky bottom-0 z-1 mx-auto -mt-14 flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-gradient-to-t from-page-fade from-55% to-transparent px-2 pt-14 pb-3 md:px-4 md:pb-4 [&>*]:pointer-events-auto">
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
            <p className="m-0 text-center text-[0.6875rem] text-muted-foreground/70">
              {t("workspace.boundary")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
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
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  /** Written while a turn is running: sent as soon as the turn ends, never dropped. */
  const [queued, setQueued] = useState<string>();
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
      // A document stored while the form is open fills that form from its page text right away;
      // the fact review below runs in parallel.
      if (anyFormViewerMounted()) {
        chat.clearError();
        void chat.send(
          i18n.locale === "en"
            ? "Please take the details from the uploaded document."
            : "Bitte übernimm die Daten aus dem hochgeladenen Dokument.",
        );
      }
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
  const submit = (text: string, reply = false): void => {
    const trimmed = text.trim();
    if (!trimmed || awaiting) return;
    setInput("");
    if (busy) {
      setQueued((current) => (current ? `${current}\n${trimmed}` : trimmed));
      return;
    }
    chat.clearError();
    void chat.send(trimmed, reply);
  };
  // A tool call still waiting for the app belongs to the running turn; a send would supersede it.
  const waitingForApp =
    last?.role === "assistant" &&
    last.parts.some(
      (part) =>
        isToolUIPart(part) &&
        (part.state === "input-streaming" || part.state === "input-available"),
    );
  // Sending stops a running form fill, so a queued message also waits for the typing to finish.
  const [formFilling, setFormFilling] = useState(false);
  useEffect(() => {
    const update = (event: Event): void => {
      if (event instanceof CustomEvent) setFormFilling(event.detail === true);
    };
    window.addEventListener(FORM_FILLING_EVENT, update);
    return () => window.removeEventListener(FORM_FILLING_EVENT, update);
  }, []);
  const sendQueued = !busy && !awaiting && !waitingForApp && !formFilling ? queued : undefined;
  const send = chat.send;
  const clearError = chat.clearError;
  useEffect(() => {
    if (!sendQueued) return;
    // A grace period lets actions from the finished turn start their fill before the send.
    const timer = setTimeout(() => {
      setQueued(undefined);
      clearError();
      void send(sendQueued);
    }, QUEUE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [sendQueued, send, clearError]);
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
  const status = chat.status;
  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden" data-chat-surface="">
      <DocumentDropZone importer={importer} className="flex min-w-0 flex-1">
        <section
          aria-labelledby="conversation-title"
          className="flex min-w-0 flex-1 flex-col bg-page-sidebar"
        >
          <ChatHeader showSidebarToggle={showSidebarToggle} title={t("workspace.title")} />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-page md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40 native:md:border-0">
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
                  className="m-0 whitespace-pre-wrap pl-10 text-[0.8125rem] text-muted-foreground"
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
              <div className="grid gap-3 pl-10">
                <ConversationForm
                  dock={dock}
                  messages={chat.messages}
                  language={i18n.locale === "en" ? "en" : "de"}
                  contexts={contexts}
                  onApprovalDecision={(decision) => {
                    void chat.addToolApprovalResponse(decision);
                  }}
                />
              </div>
              <FactsReview
                facts={[...facts, ...proposals]}
                error={factsError}
                retrying={extracting}
                onRetry={() => {
                  if (lastUpload) void extractUploaded(lastUpload);
                  else void refreshFacts().catch(() => setFactsError(true));
                }}
                onSaved={async (fact) => {
                  await refreshFacts();
                  setProposals((current) => current.filter((proposal) => proposal.id !== fact.id));
                }}
              />
            </Messages>

            <div
              data-chat-reply-area=""
              className="pointer-events-none sticky bottom-0 z-1 mx-auto -mt-14 flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-gradient-to-t from-page-fade from-55% to-transparent px-2 pt-14 pb-3 md:px-4 md:pb-4 [&>*]:pointer-events-auto"
            >
              {(chat.error || chat.bridgeError) && (
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2 text-[0.8125rem] text-foreground"
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
              {!busy && !awaiting && (
                <OpenOfferReplies messages={chat.messages} onReply={(text) => submit(text, true)} />
              )}
              {queued && (
                <div
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/60 px-3.5 py-2 text-[0.8125rem]"
                  role="status"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground">{t("workspace.queued")}</span>{" "}
                    <span className="line-clamp-2 [overflow-wrap:anywhere]">{queued}</span>
                  </span>
                  <UiButton
                    onClick={() => {
                      setInput(input.trim() ? `${queued}\n${input}` : queued);
                      setQueued(undefined);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {t("workspace.queuedEdit")}
                  </UiButton>
                </div>
              )}
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
              <p className="m-0 text-center text-[0.6875rem] text-muted-foreground/70">
                {t("workspace.boundary")}
              </p>
            </div>
          </div>
        </section>
      </DocumentDropZone>
      {/* Form slot: the open form docks here beside the chat on wide windows. */}
      <div ref={setDock} style={{ display: "contents" }} />
    </div>
  );
}
