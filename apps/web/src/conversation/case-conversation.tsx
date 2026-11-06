"use client";

import { isToolUIPart } from "ai";
import { type ReactElement, useEffect, useState } from "react";
import { z } from "zod";
import { AutonomyConfirmation } from "../features/autonomy/confirmation.tsx";
import {
  type ApprovalResponder,
  type FormGroupApproval,
  FormGroupApprovalSchema,
} from "../features/form-viewer/approval.tsx";
import styles from "./conversation.module.css";
import { continuityCopy } from "./copy.ts";
import { JobsPanel } from "./jobs-panel.tsx";
import { retryUserText } from "./retry.ts";
import { useCaseConversation } from "./use-case-conversation.ts";

export function CaseConversation({
  caseId,
  language,
  onFormApproval,
  onFormUpdated,
}: {
  caseId: string;
  language: "de" | "en";
  onFormApproval?: ((approval: FormGroupApproval, respond: ApprovalResponder) => void) | undefined;
  onFormUpdated?: ((id: string) => void) | undefined;
}): ReactElement {
  const copy = continuityCopy[language];
  const chat = useCaseConversation(caseId, language);
  useEffect(() => {
    if (!onFormApproval) return;
    const message = chat.messages.at(-1);
    for (const part of message?.parts ?? []) {
      if (part.type === "tool-form.commitGroup" && part.state === "output-available") {
        const completed = z.object({ formInstanceId: z.string() }).safeParse(part.input);
        if (completed.success) onFormUpdated?.(completed.data.formInstanceId);
      }
      if (part.type !== "tool-form.commitGroup" || part.state !== "approval-requested") continue;
      const context = message?.parts.find(
        (candidate) =>
          candidate.type === "data-approval-context" &&
          candidate.data.approvalId === part.approval.id,
      );
      if (context?.type !== "data-approval-context") continue;
      const input = z.record(z.string(), z.unknown()).safeParse(part.input);
      if (!input.success) continue;
      const request = FormGroupApprovalSchema.safeParse({ ...input.data, context: context.data });
      if (request.success)
        onFormApproval(request.data, async (decision) => {
          await chat.addToolApprovalResponse(decision);
        });
    }
  }, [chat.messages, chat.addToolApprovalResponse, onFormApproval, onFormUpdated]);
  const [input, setInput] = useState("");
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const retryText = retryUserText(chat.messages);
  const pending = chat.messages
    .at(-1)
    ?.parts.some(
      (part) =>
        isToolUIPart(part) &&
        ["approval-requested", "approval-responded", "input-available"].includes(part.state),
    );
  return (
    <section className={styles.conversation} aria-labelledby="conversation-title">
      <h1 id="conversation-title">{copy.title}</h1>
      {!chat.loaded && <p role="status">{chat.loadFailed ? copy.failed : copy.loading}</p>}
      {chat.loadFailed && (
        <button type="button" onClick={chat.reload}>
          {copy.retry}
        </button>
      )}
      {chat.error && <p role="alert">{copy.requestFailed}</p>}
      {chat.error && (
        <button
          type="button"
          disabled={pending || !retryText}
          onClick={() => {
            chat.clearError();
            if (retryText) void chat.sendMessage({ text: retryText });
          }}
        >
          {copy.retry}
        </button>
      )}
      <ol className={styles.messages}>
        {chat.messages.map((message) => (
          <li key={message.id}>
            <strong>{message.role === "user" ? copy.you : copy.assistant}</strong>
            <p>
              {message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n\n")}
            </p>
            <AutonomyConfirmation
              message={message}
              language={language}
              active={!busy && chat.loaded && message.id === chat.messages.at(-1)?.id}
              onDecision={(text) => chat.sendMessage({ text })}
            />
            {message.parts.map((part) => {
              if (isToolUIPart(part) && part.state === "output-error")
                return (
                  <p role="alert" key={part.toolCallId}>
                    {copy.requestFailed}
                  </p>
                );
              if (!isToolUIPart(part) || part.state !== "approval-requested") return null;
              if (part.type === "tool-form.commitGroup" && onFormApproval) return null;
              const context = message.parts.find(
                (candidate) =>
                  candidate.type === "data-approval-context" &&
                  candidate.data.approvalId === part.approval.id,
              );
              const proposed = z.object({ value: z.string() }).safeParse(part.input);
              return (
                <div className={styles.approval} key={part.toolCallId}>
                  <p>
                    {context?.type === "data-approval-context"
                      ? context.data.summary
                      : copy.approval}
                  </p>
                  {proposed.success && (
                    <p>
                      <strong>{copy.proposedValue}</strong>
                      <br />
                      {proposed.data.value}
                    </p>
                  )}
                  {context?.type === "data-approval-context" &&
                    [
                      ...new Set(
                        context.data.provenance.flatMap((provenance) =>
                          provenance.source.quote ? [provenance.source.quote] : [],
                        ),
                      ),
                    ].map((quote) => <blockquote key={quote}>{quote}</blockquote>)}
                  <details>
                    <summary>{copy.actionDetails}</summary>
                    <pre>{JSON.stringify(part.input, null, 2)}</pre>
                  </details>
                  <button
                    type="button"
                    disabled={busy || !chat.loaded}
                    onClick={() => {
                      void chat.addToolApprovalResponse({ id: part.approval.id, approved: true });
                    }}
                  >
                    {copy.approve}
                  </button>{" "}
                  <button
                    type="button"
                    disabled={busy || !chat.loaded}
                    onClick={() => {
                      void chat.addToolApprovalResponse({ id: part.approval.id, approved: false });
                    }}
                  >
                    {copy.deny}
                  </button>
                </div>
              );
            })}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || busy || pending || !chat.loaded) return;
          void chat.sendMessage({ text: input });
          setInput("");
        }}
      >
        <label htmlFor="case-message">{copy.message}</label>
        <textarea
          id="case-message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!chat.loaded || busy || pending}
        />
        {pending && <p role="status">{copy.pending}</p>}
        <button type="submit" disabled={!chat.loaded || busy || pending || !input.trim()}>
          {copy.send}
        </button>
        {busy && (
          <button type="button" onClick={() => void chat.stop()}>
            {copy.stop}
          </button>
        )}
      </form>
      <JobsPanel jobs={chat.jobs} setJobs={chat.setJobs} language={language} />
    </section>
  );
}
