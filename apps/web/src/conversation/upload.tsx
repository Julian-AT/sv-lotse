"use client";

import { Button } from "@lotse/ui";
import { PaperclipIcon } from "lucide-react";
import {
  type DragEvent,
  type JSX,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { PromptInputButton } from "@/components/ai-elements/prompt-input.tsx";
import { hasNativeBridge } from "../bridge/index.ts";
import { useI18n } from "../i18n/provider.tsx";
import { uploadDocument } from "./api.ts";
import { WORKSPACE_CONFIG } from "./config.ts";
import styles from "./import.module.css";
import { DocumentPreviewDialog } from "./import-preview.tsx";

/**
 * idle: nothing chosen; rejected: wrong type or size, nothing previewed;
 * previewing/storing/failed: the preview dialog is open; stored: the server confirmed the document.
 */
export type DocumentImportStatus =
  | "idle"
  | "rejected"
  | "previewing"
  | "storing"
  | "failed"
  | "stored";

export interface DocumentImport {
  file: File | undefined;
  status: DocumentImportStatus;
  disabled: boolean;
  choose: (file: File) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
}

export function isAcceptedDocument(file: File): boolean {
  return (
    file.size > 0 &&
    file.size <= WORKSPACE_CONFIG.maxUploadBytes &&
    WORKSPACE_CONFIG.acceptedDocuments.some((type) => type === file.type)
  );
}

/** Nothing reaches the server before the person confirms the preview (FR-D1). */
export function useDocumentImport({
  subjectId,
  onUploaded,
}: {
  subjectId?: string | undefined;
  onUploaded: (documentId: string) => void;
}): DocumentImport {
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState<DocumentImportStatus>("idle");
  const storing = status === "storing";
  const disabled = !subjectId || storing;
  const choose = (next: File): void => {
    if (disabled) return;
    if (!isAcceptedDocument(next)) {
      setFile(undefined);
      setStatus("rejected");
      return;
    }
    setFile(next);
    setStatus("previewing");
  };
  const confirm = async (): Promise<void> => {
    if (!file || !subjectId || storing) return;
    setStatus("storing");
    try {
      const documentId = await uploadDocument(file, subjectId, hasNativeBridge() ? "mac" : "web");
      setFile(undefined);
      setStatus("stored");
      onUploaded(documentId);
    } catch {
      setStatus("failed");
    }
  };
  const cancel = (): void => {
    if (storing) return;
    setFile(undefined);
    setStatus("idle");
  };
  return { file, status, disabled, choose, confirm, cancel };
}

function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Pointer shortcut for the file picker; DocumentUpload stays the keyboard path. */
export function DocumentDropZone({
  importer,
  className = "",
  children,
}: {
  importer: DocumentImport;
  className?: string | undefined;
  children?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    // A file dropped beside the zone must not navigate the tab away from the conversation.
    const keepPage = (event: globalThis.DragEvent): void => {
      if (carriesFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", keepPage);
    window.addEventListener("drop", keepPage);
    return () => {
      window.removeEventListener("dragover", keepPage);
      window.removeEventListener("drop", keepPage);
    };
  }, []);
  const enter = (event: DragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const over = (event: DragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = importer.disabled ? "none" : "copy";
  };
  const leave = (event: DragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = event.dataTransfer?.files[0];
    if (file) importer.choose(file);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Dropping is a pointer shortcut; DocumentUpload's file picker supplies the keyboard path.
    <div
      className={`${styles.dropZone} ${className}`}
      data-dragging={dragging && !importer.disabled ? "true" : undefined}
      onDragEnter={enter}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
    >
      {children}
      {dragging && !importer.disabled && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <p>{t("workspace.import.drop")}</p>
        </div>
      )}
    </div>
  );
}

/** File picker, status and the preview dialog shared by the picker and drag and drop. */
export function DocumentUpload({
  importer,
  compact = false,
}: {
  importer: DocumentImport;
  /** Composer variant: a paperclip icon button whose accessible name stays "Dokument hochladen". */
  compact?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const { file, status } = importer;
  return (
    <div
      className={compact ? "flex items-center gap-2 text-xs text-muted-foreground" : styles.upload}
    >
      <input
        ref={input}
        type="file"
        hidden
        accept={WORKSPACE_CONFIG.acceptedDocuments.join(",")}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen) importer.choose(chosen);
        }}
      />
      {compact ? (
        <PromptInputButton
          aria-label={t(status === "storing" ? "workspace.uploading" : "workspace.upload")}
          title={t("workspace.upload")}
          disabled={importer.disabled}
          aria-describedby={hint}
          onClick={() => input.current?.click()}
        >
          <PaperclipIcon />
        </PromptInputButton>
      ) : (
        <Button
          variant="secondary"
          disabled={importer.disabled}
          aria-describedby={hint}
          onClick={() => input.current?.click()}
        >
          {t(status === "storing" ? "workspace.uploading" : "workspace.upload")}
        </Button>
      )}
      <p id={hint} className={compact ? "sr-only" : styles.hint}>
        {t("workspace.import.hint")}
      </p>
      {status === "stored" && <p role="status">{t("workspace.uploaded")}</p>}
      {status === "rejected" && <p role="alert">{t("workspace.uploadError")}</p>}
      {file && (
        <DocumentPreviewDialog
          file={file}
          storing={status === "storing"}
          failed={status === "failed"}
          onCancel={importer.cancel}
          onConfirm={() => void importer.confirm()}
        />
      )}
    </div>
  );
}
