"use client";

import {
  type FieldCorrection,
  type ViewerInstance,
  ViewerInstanceSchema,
} from "@lotse/brain/forms/viewer/schema";
import type { Action, ActionResult, TargetRect } from "@lotse/protocol";
import { FileTextIcon, ListIcon, SquareIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspacePreferences } from "../settings/speech-preferences.ts";
import {
  type ApprovalResponder,
  type FormGroupApproval,
  FormGroupConfirmation,
} from "./approval.tsx";
import { measureFieldTarget, reportFormTargetRect, subscribeFormViewerBridge } from "./bridge.ts";
import { FORM_VIEWER_CONFIG, formInstanceUrl } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { FormFieldList, fillableFieldCount, filledFieldCount } from "./field-list.tsx";
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
  onClose?: (() => void) | undefined;
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
  const [view, setView] = useState<"fields" | "pdf">("fields");
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
    ready: Boolean(
      instance &&
        !reviewing &&
        (view === "fields" || (pdf && readyPages.size === pdf.document.numPages)),
    ),
    elements: elements.current,
    language,
    slow,
    cursorSpeed: preferences.cursorSpeed,
    reducedMotion: preferences.reducedMotion,
    onTargetRect: props.onTargetRect ?? reportFormTargetRect,
    onActionResult: props.onActionResult,
    onSettled: () => void reload().catch(() => setError(true)),
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

  const surface =
    view === "fields"
      ? instance
        ? "fields"
        : ""
      : readyPages.size
        ? `pdf-${readyPages.size}`
        : "";
  useEffect(() => {
    if (!surface) return;
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
  }, [surface, props.onTargetRect]);

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
  const filled = instance ? filledFieldCount(instance) : 0;
  const fillableCount = instance ? fillableFieldCount(instance) : 0;
  const status = reviewSaved
    ? reviewCopy[language].saved
    : live.caption ||
      (instance ? copy.progress(filled, fillableCount) : error ? copy.error : copy.loading);
  const zoomBy = (step: number): void =>
    setZoom((value) =>
      Math.min(FORM_VIEWER_CONFIG.maxZoom, Math.max(FORM_VIEWER_CONFIG.minZoom, value + step)),
    );
  return (
    <TooltipProvider delayDuration={200}>
      <section className="flex min-h-0 flex-1 flex-col" aria-label={copy.title}>
        <header className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base leading-tight font-semibold">
                {instance?.title ?? copy.title}
              </h2>
              <Badge variant="secondary">{copy.draftBadge}</Badge>
            </div>
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="m-0 line-clamp-2 text-xs text-muted-foreground"
            >
              {status}
            </p>
          </div>
          {props.onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={copy.close}
              onClick={props.onClose}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2">
          <ButtonGroup>
            <Button
              type="button"
              size="xs"
              variant={view === "fields" ? "secondary" : "ghost"}
              aria-pressed={view === "fields"}
              onClick={() => setView("fields")}
            >
              <ListIcon aria-hidden="true" />
              {copy.viewFields}
            </Button>
            <Button
              type="button"
              size="xs"
              variant={view === "pdf" ? "secondary" : "ghost"}
              aria-pressed={view === "pdf"}
              disabled={!pdf}
              onClick={() => setView("pdf")}
            >
              <FileTextIcon aria-hidden="true" />
              {copy.viewPdf}
            </Button>
          </ButtonGroup>
          {view === "pdf" && (
            <>
              <ButtonGroup>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  aria-label={copy.zoomOut}
                  disabled={zoom <= FORM_VIEWER_CONFIG.minZoom}
                  onClick={() => zoomBy(-FORM_VIEWER_CONFIG.zoomStep)}
                >
                  <ZoomOutIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  aria-label={copy.zoomIn}
                  disabled={zoom >= FORM_VIEWER_CONFIG.maxZoom}
                  onClick={() => zoomBy(FORM_VIEWER_CONFIG.zoomStep)}
                >
                  <ZoomInIcon aria-hidden="true" />
                </Button>
              </ButtonGroup>
              <output className="text-xs text-muted-foreground tabular-nums">
                {Math.round(zoom * 100)}%
              </output>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={!instance || !pdf || reviewing}
                onClick={() => {
                  live.stop();
                  setReviewSaved(false);
                  setReviewing(true);
                }}
              >
                {reviewCopy[language].open}
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            {view === "pdf" && (
              <Label className="text-xs font-normal">
                <Checkbox
                  checked={largeCursor}
                  onCheckedChange={(checked) => setLargeCursor(checked === true)}
                />
                {copy.largeCursor}
              </Label>
            )}
            <Label className="text-xs font-normal">
              <Checkbox checked={slow} onCheckedChange={(checked) => setSlow(checked === true)} />
              {copy.slow}
            </Label>
            {live.isFilling && (
              <Button type="button" size="xs" variant="outline" onClick={live.stop}>
                <SquareIcon aria-hidden="true" />
                {copy.stop}
              </Button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-4 px-4 py-4">
            {props.approval && props.onApprovalDecision && instance && (
              <div className="lotse-legacy">
                <FormGroupConfirmation
                  key={props.approval.context.approvalId}
                  instance={instance}
                  approval={props.approval}
                  language={language}
                  respond={props.onApprovalDecision}
                  reload={reload}
                  blocked={live.isFilling}
                />
              </div>
            )}
            {error ? (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm">
                <p className="m-0">{copy.error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    live.stop();
                    setLoadRequest({ id: formInstanceId });
                  }}
                >
                  {copy.retry}
                </Button>
              </div>
            ) : !instance ? (
              <p
                role="status"
                className="m-0 flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Spinner aria-hidden="true" />
                {copy.loading}
              </p>
            ) : view === "fields" ? (
              <FormFieldList
                instance={instance}
                language={language}
                preview={live.preview}
                activeField={live.activeField}
                elements={elements.current}
                onEdit={edit}
                onSave={save}
              />
            ) : !pdf ? (
              <p
                role="status"
                className="m-0 flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Spinner aria-hidden="true" />
                {copy.loading}
              </p>
            ) : (
              <div className={`lotse-legacy ${styles.viewer}`}>
                {reviewing ? (
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
                          onEdit={(id) => {
                            live.stop();
                            setView("fields");
                            requestAnimationFrame(() =>
                              elements.current.get(id)?.scrollIntoView({ block: "center" }),
                            );
                          }}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {instance && (
          <FormPackage
            key={JSON.stringify(instance.fields)}
            formInstanceId={instance.id}
            language={language}
            blocked={live.isFilling || editing !== null}
          >
            {props.onClose && (
              <Button type="button" size="sm" variant="outline" onClick={props.onClose}>
                {copy.close}
              </Button>
            )}
          </FormPackage>
        )}
      </section>
    </TooltipProvider>
  );
}
