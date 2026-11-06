"use client";

import {
  type FieldCorrection,
  type ViewerInstance,
  ViewerInstanceSchema,
} from "@lotse/brain/forms/viewer/schema";
import type { Action, ActionResult, TargetRect } from "@lotse/protocol";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useWorkspacePreferences } from "../settings/speech-preferences.ts";
import {
  type ApprovalResponder,
  type FormGroupApproval,
  FormGroupConfirmation,
} from "./approval.tsx";
import { measureFieldTarget, reportFormTargetRect, subscribeFormViewerBridge } from "./bridge.ts";
import { FORM_VIEWER_CONFIG, formInstanceUrl } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { FormFieldList } from "./field-list.tsx";
import { FormPage } from "./form-page.tsx";
import { FormReview } from "./form-review.tsx";
import { FormPackage } from "./package.tsx";
import { type LoadedFormPdf, loadFormPdf } from "./pdf.ts";
import { reviewCopy } from "./review-copy.ts";
import { useLiveFill } from "./use-live-fill.ts";
import styles from "./viewer.module.css";

const noActions: readonly Action[] = [];
export interface FormViewerProps {
  formInstanceId: string;
  language?: FormViewerLanguage;
  actions?: readonly Action[];
  approval?: FormGroupApproval | undefined;
  /** Pass the workspace's addToolApprovalResponse. The server alone confirms values. */
  onApprovalDecision?: ApprovalResponder | undefined;
  onActionResult?: ((result: ActionResult) => void) | undefined;
  onTargetRect?: ((rect: TargetRect) => void | Promise<void>) | undefined;
  /** Increment when form.prefill / form.commitGroup produces a persisted tool result. */
  refreshVersion?: number;
  onInstanceLoaded?: ((instance: ViewerInstance) => void) | undefined;
}

async function fetchInstance(id: string, signal?: AbortSignal): Promise<ViewerInstance> {
  const response = await fetch(formInstanceUrl(id), {
    credentials: "same-origin",
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("FORM_INSTANCE_UNAVAILABLE");
  return ViewerInstanceSchema.parse(await response.json());
}

export function FormViewer(props: FormViewerProps): JSX.Element {
  return <FormViewerSession key={props.formInstanceId} {...props} />;
}

function FormViewerSession({
  formInstanceId,
  language = "de",
  actions = noActions,
  refreshVersion = 0,
  ...props
}: FormViewerProps): JSX.Element {
  const copy = formViewerCopy[language];
  const preferences = useWorkspacePreferences();
  const [instance, setInstance] = useState<ViewerInstance | null>(null);
  const [pdf, setPdf] = useState<LoadedFormPdf | null>(null);
  const [error, setError] = useState(false);
  const [loadRequest, setLoadRequest] = useState({ id: formInstanceId });
  const [zoom, setZoom] = useState<number>(1);
  const [slow, setSlow] = useState(false);
  const [largeCursor, setLargeCursor] = useState(false);
  const [readyPages, setReadyPages] = useState<Set<number>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const onReady = useCallback((page: number): void => {
    setReadyPages((previous) => new Set([...previous, page]));
  }, []);
  const onError = useCallback((): void => {
    setError(true);
  }, []);
  const reload = useCallback(async (): Promise<void> => {
    setInstance(await fetchInstance(formInstanceId));
  }, [formInstanceId]);
  const live = useLiveFill({
    instance,
    actions,
    ready: Boolean(!reviewing && pdf && readyPages.size === pdf.document.numPages),
    elements: elements.current,
    language,
    slow,
    cursorSpeed: preferences.cursorSpeed,
    reducedMotion: preferences.reducedMotion,
    onTargetRect: props.onTargetRect ?? reportFormTargetRect,
    onActionResult: props.onActionResult,
  });
  useEffect(() => {
    if (instance) props.onInstanceLoaded?.(instance);
  }, [instance, props.onInstanceLoaded]);

  useEffect(() => {
    if (refreshVersion > 0) void reload().catch(() => setError(true));
  }, [refreshVersion, reload]);

  useEffect(
    () =>
      subscribeFormViewerBridge((message) => {
        if (message.type === "SpeechControl" && message.payload.stop) live.stop();
      }),
    [live.stop],
  );

  useEffect(() => {
    const aborter = new AbortController();
    let loaded: LoadedFormPdf | undefined;
    setError(false);
    setReadyPages(new Set());
    setPdf(null);
    void fetchInstance(loadRequest.id, aborter.signal)
      .then((result) => {
        if (!aborter.signal.aborted) setInstance(result);
      })
      .catch(() => {
        if (!aborter.signal.aborted) setError(true);
      });
    void loadFormPdf(loadRequest.id, aborter.signal)
      .then((result) => {
        loaded = result;
        if (!aborter.signal.aborted) setPdf(result);
        else void result.destroy();
      })
      .catch(() => {
        if (!aborter.signal.aborted) setError(true);
      });
    return () => {
      aborter.abort();
      void loaded?.destroy();
    };
  }, [loadRequest]);

  useEffect(() => {
    if (readyPages.size === 0) return;
    let frame = 0;
    const report = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const [fieldId, element] of elements.current) {
          void Promise.resolve(
            (props.onTargetRect ?? reportFormTargetRect)(measureFieldTarget(fieldId, element)),
          ).catch(() => {});
        }
      });
    };
    const resize = new ResizeObserver(report);
    for (const element of elements.current.values()) resize.observe(element);
    window.addEventListener("scroll", report, true);
    window.addEventListener("resize", report);
    window.visualViewport?.addEventListener("resize", report);
    report();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", report, true);
      window.removeEventListener("resize", report);
      window.visualViewport?.removeEventListener("resize", report);
      for (const [targetId, element] of elements.current) {
        const rect = element.getBoundingClientRect();
        void Promise.resolve(
          (props.onTargetRect ?? reportFormTargetRect)({
            targetId,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            scale: window.devicePixelRatio || 1,
            visible: false,
          }),
        ).catch(() => {});
      }
    };
  }, [readyPages, props.onTargetRect]);

  const edit = (id: string | null): void => {
    live.stop();
    setEditing(id);
  };
  const save = async (input: FieldCorrection): Promise<void> => {
    const response = await fetch(formInstanceUrl(formInstanceId), {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("FORM_CORRECTION_FAILED");
    setInstance(ViewerInstanceSchema.parse(await response.json()));
  };
  return (
    <section className={styles.viewer} aria-label={copy.title}>
      <h1>{instance?.title ?? copy.title}</h1>
      <div className={styles.toolbar}>
        <button
          type="button"
          disabled={!instance || !pdf || reviewing}
          onClick={() => {
            live.stop();
            setReviewSaved(false);
            setReviewing(true);
          }}
        >
          {reviewCopy[language].open}
        </button>
        <button type="button" onClick={live.stop}>
          {copy.stop}
        </button>
        <button
          type="button"
          disabled={zoom <= FORM_VIEWER_CONFIG.minZoom}
          onClick={() =>
            setZoom((value) =>
              Math.max(FORM_VIEWER_CONFIG.minZoom, value - FORM_VIEWER_CONFIG.zoomStep),
            )
          }
        >
          {copy.zoomOut}
        </button>
        <output>{Math.round(zoom * 100)}%</output>
        <button
          type="button"
          disabled={zoom >= FORM_VIEWER_CONFIG.maxZoom}
          onClick={() =>
            setZoom((value) =>
              Math.min(FORM_VIEWER_CONFIG.maxZoom, value + FORM_VIEWER_CONFIG.zoomStep),
            )
          }
        >
          {copy.zoomIn}
        </button>
        <label>
          <input
            type="checkbox"
            checked={slow}
            onChange={(event) => setSlow(event.target.checked)}
          />
          {copy.slow}
        </label>
        <label>
          <input
            type="checkbox"
            checked={largeCursor}
            onChange={(event) => setLargeCursor(event.target.checked)}
          />
          {copy.largeCursor}
        </label>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true">
        {reviewSaved ? reviewCopy[language].saved : live.caption || copy.ready}
      </p>
      {error ? (
        <div role="alert">
          <p>{copy.error}</p>
          <button
            type="button"
            onClick={() => {
              live.stop();
              setLoadRequest({ id: formInstanceId });
            }}
          >
            {copy.retry}
          </button>
        </div>
      ) : !instance || !pdf ? (
        <p role="status">{copy.loading}</p>
      ) : reviewing ? (
        <FormReview
          instance={instance}
          document={pdf.document}
          zoom={zoom}
          language={language}
          onCancel={() => setReviewing(false)}
          onSaved={async () => {
            await reload();
            setReviewing(false);
            setReviewSaved(true);
          }}
        />
      ) : (
        <>
          <div className={styles.pages}>
            {Array.from({ length: pdf.document.numPages }, (_, index) => index + 1).map(
              (pageNumber) => (
                <FormPage
                  key={pageNumber}
                  document={pdf.document}
                  pageNumber={pageNumber}
                  zoom={zoom}
                  instance={instance}
                  language={language}
                  preview={live.preview}
                  activeField={live.activeField}
                  largeCursor={largeCursor}
                  cursorSize={preferences.cursorSize}
                  elements={elements.current}
                  onReady={onReady}
                  onError={onError}
                  onEdit={edit}
                />
              ),
            )}
          </div>
          {props.approval && props.onApprovalDecision && (
            <FormGroupConfirmation
              key={props.approval.context.approvalId}
              instance={instance}
              approval={props.approval}
              language={language}
              respond={props.onApprovalDecision}
              reload={reload}
              blocked={live.isFilling}
            />
          )}
          <FormFieldList
            instance={instance}
            language={language}
            editing={editing}
            onEdit={edit}
            onSave={save}
          />
          <FormPackage
            key={JSON.stringify(instance.fields)}
            formInstanceId={instance.id}
            language={language}
            blocked={live.isFilling || editing !== null}
          />
        </>
      )}
    </section>
  );
}
