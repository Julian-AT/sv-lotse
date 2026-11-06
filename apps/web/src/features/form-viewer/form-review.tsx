"use client";
import { type ReviewedField, ReviewedFieldSchema } from "@lotse/brain/forms/registry/schema";
import type { ViewerInstance } from "@lotse/brain/forms/viewer/schema";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { FORM_REVIEW_CONFIG, formTemplateUrl } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { positionPageFields } from "./geometry.ts";
import { renderFormPage } from "./pdf.ts";
import { reviewCopy } from "./review-copy.ts";
import { ReviewFieldEditor } from "./review-editor.tsx";
import { constrainReviewBox, type ReviewPageSize } from "./review-geometry.ts";
import { ReviewOverlay } from "./review-overlay.tsx";
import styles from "./viewer.module.css";

type ReviewPage = { page: PDFPageProxy; size: ReviewPageSize };
function ReviewPdfPage(props: {
  page: ReviewPage;
  zoom: number;
  language: FormViewerLanguage;
  children: JSX.Element;
  onError: () => void;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { page, zoom, onError } = props;
  useEffect(() => {
    if (!canvas.current) return;
    const render = renderFormPage(page.page, canvas.current, zoom);
    let disposed = false;
    void render.done.catch(() => {
      if (!disposed) onError();
    });
    return () => {
      disposed = true;
      render.cancel();
    };
  }, [page, zoom, onError]);
  return (
    <section
      className={styles.pageSection}
      aria-label={`${formViewerCopy[props.language].page} ${page.page.pageNumber}`}
    >
      <div
        className={styles.page}
        style={{ width: page.size.width * zoom, height: page.size.height * zoom }}
      >
        <canvas
          ref={canvas}
          className={styles.canvas}
          role="img"
          aria-label={`${formViewerCopy[props.language].page} ${page.page.pageNumber}`}
        />
        {props.children}
      </div>
    </section>
  );
}

export function FormReview(props: {
  instance: ViewerInstance;
  document: PDFDocumentProxy;
  zoom: number;
  language: FormViewerLanguage;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const copy = reviewCopy[props.language];
  const [pages, setPages] = useState<ReviewPage[]>([]);
  const [fields, setFields] = useState<ReviewedField[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const onPageError = useCallback((): void => setError(true), []);
  const { document, instance } = props;
  useEffect(() => {
    let disposed = false;
    void Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        const size = page.getViewport({ scale: 1 });
        const positions = await positionPageFields(page, instance.schema.fields);
        return {
          page,
          size: { width: size.width, height: size.height },
          fields: positions.map(({ field, bounds }) =>
            ReviewedFieldSchema.parse({
              id: field.id,
              label_de: field.label_de,
              type: field.type,
              owner: field.owner,
              box: {
                page: index + 1,
                x: bounds.x * size.width,
                y: bounds.y * size.height,
                width: bounds.width * size.width,
                height: bounds.height * size.height,
              },
            }),
          ),
        };
      }),
    )
      .then((loaded) => {
        if (disposed) return;
        setPages(loaded);
        const byId = new Map(
          loaded.flatMap((page) => page.fields).map((field) => [field.id, field]),
        );
        setFields([...byId.values()]);
        setSelected(byId.keys().next().value ?? null);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
    };
  }, [document, instance]);
  const change = (field: ReviewedField): void => {
    setFields((previous) => previous.map((item) => (item.id === field.id ? field : item)));
    setConfirmed((previous) => {
      const next = new Set(previous);
      next.delete(field.id);
      return next;
    });
  };
  const add = (box: ReviewedField["box"]): ReviewedField => {
    const field: ReviewedField = {
      id: crypto.randomUUID(),
      label_de: copy.add,
      type: "text",
      owner: "applicant",
      box,
    };
    setFields((previous) => [...previous, field]);
    setSelected(field.id);
    return field;
  };
  const active = fields.find((field) => field.id === selected);
  const save = async (): Promise<void> => {
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(formTemplateUrl(instance.templateId), {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formInstanceId: instance.id, fields }),
      });
      if (!response.ok) throw new Error("FORM_REVIEW_FAILED");
      await props.onSaved();
    } catch {
      setError(true);
      setSaving(false);
    }
  };
  return (
    <section aria-label={copy.title} aria-busy={saving}>
      <h2>{copy.title}</h2>
      <p>{copy.instructions}</p>
      {error && <p role="alert">{copy.error}</p>}
      <fieldset disabled={saving} className={styles.reviewControls}>
        <legend>{copy.title}</legend>
        <button
          type="button"
          disabled={!pages.length}
          onClick={() => {
            const size = pages[0]?.size;
            if (size) add(constrainReviewBox({ page: 1, ...FORM_REVIEW_CONFIG.newField }, size));
          }}
        >
          {copy.add}
        </button>
        <button type="button" aria-pressed={drawing} onClick={() => setDrawing((value) => !value)}>
          {copy.draw}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={
            !fields.length ||
            fields.some((field) => !confirmed.has(field.id) || !field.label_de.trim())
          }
        >
          {saving ? copy.saving : copy.save}
        </button>
        <button type="button" onClick={props.onCancel}>
          {copy.cancel}
        </button>
        <div className={styles.pages}>
          {pages.map((page) => (
            <ReviewPdfPage
              key={page.page.pageNumber}
              page={page}
              zoom={props.zoom}
              language={props.language}
              onError={onPageError}
            >
              <ReviewOverlay
                page={page.page.pageNumber}
                size={page.size}
                fields={fields}
                selected={selected}
                confirmed={confirmed}
                drawing={drawing}
                language={props.language}
                onSelect={setSelected}
                onChange={change}
                onAdd={add}
              />
            </ReviewPdfPage>
          ))}
        </div>
        <ul className={styles.reviewFieldList}>
          {fields.map((field) => (
            <li key={field.id}>
              <button
                type="button"
                aria-pressed={selected === field.id}
                onClick={() => setSelected(field.id)}
              >
                {field.label_de} – {confirmed.has(field.id) ? copy.confirmed : copy.pending}
              </button>
            </li>
          ))}
        </ul>
        {active && (
          <ReviewFieldEditor
            field={active}
            pages={pages.map((page) => page.size)}
            language={props.language}
            confirmed={confirmed.has(active.id)}
            onChange={change}
            onConfirm={() => setConfirmed((previous) => new Set([...previous, active.id]))}
            onRemove={() => {
              setFields((previous) => previous.filter((field) => field.id !== active.id));
              setSelected(null);
            }}
          />
        )}
      </fieldset>
    </section>
  );
}
