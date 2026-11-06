"use client";

import { Button, Dialog, en, Heading, Inline } from "@lotse/ui";
import Image from "next/image";
import { type JSX, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { FORM_VIEWER_CONFIG } from "../features/form-viewer/config.ts";
import { renderFormPage } from "../features/form-viewer/pdf.ts";
import { useI18n } from "../i18n/provider.tsx";
import { WORKSPACE_CONFIG } from "./config.ts";
import styles from "./import.module.css";

type Thumbnail = "loading" | "ready" | "failed";
interface Preview {
  pages: number | undefined;
  thumbnail: Thumbnail;
  imageUrl: string | undefined;
}
const BYTES_PER_KILOBYTE = 1000;
const BYTES_PER_MEGABYTE = 1_000_000;

/** Reads the page count and draws page 1 in the browser; nothing leaves the device here. */
function usePdfPreview(
  file: File,
  canvas: RefObject<HTMLCanvasElement | null>,
  update: (change: Partial<Preview>) => void,
): void {
  useEffect(() => {
    if (file.type !== "application/pdf") return;
    const controller = new AbortController();
    let destroy: (() => Promise<void>) | undefined;
    let cancel: (() => void) | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `${FORM_VIEWER_CONFIG.pdfAssets}build/pdf.worker.min.mjs`;
        const data = new Uint8Array(await file.arrayBuffer());
        if (controller.signal.aborted) return;
        const task = pdfjs.getDocument({
          data,
          verbosity: 0,
          enableXfa: false,
          cMapUrl: `${FORM_VIEWER_CONFIG.pdfAssets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${FORM_VIEWER_CONFIG.pdfAssets}standard_fonts/`,
          wasmUrl: `${FORM_VIEWER_CONFIG.pdfAssets}wasm/`,
        });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        if (controller.signal.aborted) return;
        update({ pages: pdf.numPages });
        const page = await pdf.getPage(1);
        const target = canvas.current;
        if (controller.signal.aborted || !target) return;
        const width = page.getViewport({ scale: 1 }).width;
        const render = renderFormPage(page, target, WORKSPACE_CONFIG.importPreviewWidth / width);
        cancel = render.cancel;
        await render.done;
        if (!controller.signal.aborted) update({ thumbnail: "ready" });
      } catch {
        if (!controller.signal.aborted) update({ thumbnail: "failed" });
      }
    })();
    return () => {
      controller.abort();
      cancel?.();
      void destroy?.();
    };
  }, [file, canvas, update]);
}

function useDocumentPreview(file: File, canvas: RefObject<HTMLCanvasElement | null>): Preview {
  const [preview, setPreview] = useState<Preview>({
    pages: undefined,
    thumbnail: "loading",
    imageUrl: undefined,
  });
  const update = useCallback(
    (change: Partial<Preview>): void => setPreview((current) => ({ ...current, ...change })),
    [],
  );
  useEffect(() => {
    if (file.type === "application/pdf") return;
    const imageUrl = URL.createObjectURL(file);
    setPreview({ pages: 1, thumbnail: "ready", imageUrl });
    return () => URL.revokeObjectURL(imageUrl);
  }, [file]);
  usePdfPreview(file, canvas, update);
  return preview;
}

function fileTypeLabel(file: File): string {
  return (file.type.split("/").at(1) ?? file.type).toUpperCase();
}

function fileSizeLabel(
  bytes: number,
  format: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (bytes >= BYTES_PER_MEGABYTE)
    return format(bytes / BYTES_PER_MEGABYTE, {
      style: "unit",
      unit: "megabyte",
      maximumFractionDigits: 1,
    });
  return format(Math.max(1, Math.round(bytes / BYTES_PER_KILOBYTE)), {
    style: "unit",
    unit: "kilobyte",
  });
}

/** FR-D1: shows what will be stored before anything is sent; cancel leaves no trace. */
export function DocumentPreviewDialog({
  file,
  storing,
  failed,
  onCancel,
  onConfirm,
}: {
  file: File;
  storing: boolean;
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const { t, locale, formatNumber } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stored = useId();
  const { pages, thumbnail, imageUrl } = useDocumentPreview(file, canvas);
  const pageLabel =
    pages !== undefined
      ? t("workspace.import.pageCount", { count: pages })
      : thumbnail === "failed"
        ? t("workspace.import.pagesUnknown")
        : "…";
  return (
    <Dialog
      open
      title={t("workspace.import.title")}
      description={t("workspace.import.description")}
      onClose={onCancel}
      labels={locale === "en" ? en : {}}
    >
      <div className={styles.preview}>
        <figure className={styles.thumbnail}>
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={t("workspace.import.thumbnail")}
              width={WORKSPACE_CONFIG.importPreviewWidth}
              height={WORKSPACE_CONFIG.importPreviewWidth}
              unoptimized
            />
          ) : (
            <canvas
              ref={canvas}
              role="img"
              aria-label={t("workspace.import.thumbnail")}
              hidden={thumbnail === "failed"}
            />
          )}
          {thumbnail === "loading" && <p role="status">{t("workspace.import.previewLoading")}</p>}
          {thumbnail === "failed" && <p>{t("workspace.import.previewError")}</p>}
        </figure>
        <dl className={styles.details}>
          <dt>{t("workspace.import.fileName")}</dt>
          <dd>{file.name}</dd>
          <dt>{t("workspace.import.fileType")}</dt>
          <dd>{fileTypeLabel(file)}</dd>
          <dt>{t("workspace.import.fileSize")}</dt>
          <dd>{fileSizeLabel(file.size, formatNumber)}</dd>
          <dt>{t("workspace.import.pages")}</dt>
          <dd>{pageLabel}</dd>
        </dl>
      </div>
      <section aria-labelledby={stored} className={styles.stored}>
        <Heading level={3} id={stored}>
          {t("workspace.import.stored")}
        </Heading>
        <ul>
          <li>{t("workspace.import.storedOriginal")}</li>
          <li>{t("workspace.import.storedText")}</li>
          <li>{t("workspace.import.storedDetails")}</li>
        </ul>
        <p>{t("workspace.import.notStored")}</p>
      </section>
      {failed && <p role="alert">{t("workspace.import.storeError")}</p>}
      <Inline className={styles.actions}>
        <Button variant="secondary" disabled={storing} onClick={onCancel}>
          {t("workspace.cancel")}
        </Button>
        <Button loading={storing} onClick={onConfirm}>
          {t("workspace.import.confirm")}
        </Button>
      </Inline>
    </Dialog>
  );
}
