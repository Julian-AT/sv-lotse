// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md). Markup and classes are the
// template's; the model selector, slash commands and blob uploads are replaced by SV KI-Lotse's
// document import (with its preview dialog) and our German copy.
"use client";

import { ArrowUpIcon } from "lucide-react";
import { type ChangeEvent, memo, useCallback, useEffect, useRef } from "react";
import { WORKSPACE_CONFIG } from "@/conversation/config.ts";
import { DocumentPreviewDialog } from "@/conversation/import-preview.tsx";
import type { DocumentImport } from "@/conversation/upload.tsx";
import { useI18n } from "@/i18n/provider.tsx";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Button } from "../ui/button";
import { PaperclipIcon, StopIcon } from "./icons";
import { NativeVoiceButton } from "./native-voice-button";
import { PreviewAttachment } from "./preview-attachment";
import { SuggestedActions } from "./suggested-actions";

type Status = "submitted" | "streaming" | "ready" | "error";

function PureMultimodalInput({
  input,
  setInput,
  status,
  stop,
  importer,
  hasMessages,
  disabled,
  sendMessage,
  className,
}: {
  input: string;
  setInput: (value: string) => void;
  status: Status;
  stop: () => void;
  importer: DocumentImport;
  hasMessages: boolean;
  /** An approval is pending: the user answers it before writing on. */
  disabled: boolean;
  sendMessage: (text: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleInput = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setInput(event.target.value);
    },
    [setInput],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0];
      event.target.value = "";
      if (chosen) importer.choose(chosen);
    },
    [importer],
  );

  const handlePromptSubmit = useCallback(() => {
    if (!input.trim() || busy || disabled) {
      return;
    }
    sendMessage(input.trim());
    setInput("");
    textareaRef.current?.focus();
  }, [busy, disabled, input, sendMessage, setInput]);

  const { file, status: uploadStatus } = importer;

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {!hasMessages && !busy && !file && <SuggestedActions sendMessage={sendMessage} />}

      <input
        accept={WORKSPACE_CONFIG.acceptedDocuments.join(",")}
        aria-label={t("workspace.upload")}
        className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
        data-testid="document-input"
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <PromptInput
        className="[&>div]:rounded-2xl [&>div]:border [&>div]:glass [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
        onSubmit={handlePromptSubmit}
      >
        {file && (
          <div
            className="flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar"
            data-testid="attachments-preview"
          >
            <PreviewAttachment
              attachment={{ contentType: file.type, name: file.name, url: "" }}
              isUploading={uploadStatus === "storing"}
            />
          </div>
        )}
        <label className="sr-only" htmlFor="workspace-message">
          {t("workspace.message")}
        </label>
        <PromptInputTextarea
          className="min-h-24 text-[0.8125rem] leading-relaxed px-4 pt-3.5 pb-1.5 placeholder:text-muted-foreground/35"
          data-testid="multimodal-input"
          disabled={disabled}
          id="workspace-message"
          onChange={handleInput}
          placeholder={t("workspace.placeholder")}
          ref={textareaRef}
          value={input}
        />
        <PromptInputFooter className="px-3 pb-3">
          <PromptInputTools>
            <Button
              aria-label={t(
                uploadStatus === "storing" ? "workspace.uploading" : "workspace.upload",
              )}
              className="h-7 w-7 rounded-lg border border-border/40 p-1 text-foreground transition-colors hover:border-border hover:text-foreground"
              data-testid="attachments-button"
              disabled={importer.disabled}
              onClick={(event) => {
                event.preventDefault();
                fileInputRef.current?.click();
              }}
              title={t("workspace.upload")}
              variant="ghost"
            >
              <PaperclipIcon size={14} style={{ height: 14, width: 14 }} />
            </Button>
            {uploadStatus === "stored" && (
              <span className="text-[0.75rem] text-muted-foreground" role="status">
                {t("workspace.uploaded")}
              </span>
            )}
            {uploadStatus === "rejected" && (
              <span className="text-[0.75rem] text-destructive" role="alert">
                {t("workspace.uploadError")}
              </span>
            )}
          </PromptInputTools>

          <div className="flex items-center gap-1.5">
            <NativeVoiceButton disabled={disabled} />
            {busy ? (
              <StopButton label={t("workspace.stop")} stop={stop} />
            ) : (
              <PromptInputSubmit
                aria-label={t("workspace.send")}
                className={cn(
                  "h-7 w-7 rounded-xl transition-all duration-200",
                  input.trim() && !disabled
                    ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                    : "bg-muted text-muted-foreground/25 cursor-not-allowed",
                )}
                data-testid="send-button"
                disabled={!input.trim() || disabled}
                status={status}
                variant="secondary"
              >
                <ArrowUpIcon className="size-4" />
              </PromptInputSubmit>
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>

      {file && (
        <DocumentPreviewDialog
          failed={uploadStatus === "failed"}
          file={file}
          onCancel={importer.cancel}
          onConfirm={() => void importer.confirm()}
          storing={uploadStatus === "storing"}
        />
      )}
    </div>
  );
}

export const MultimodalInput = memo(PureMultimodalInput);

function PureStopButton({ stop, label }: { stop: () => void; label: string }) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      stop();
    },
    [stop],
  );

  return (
    <Button
      aria-label={label}
      className="h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={handleClick}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
