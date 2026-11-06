"use client";

import { isEditableField, type ViewerInstance } from "@lotse/brain/forms/viewer/schema";
import type { TypePayload } from "@lotse/protocol";
import { FormFieldOverlay } from "@lotse/ui";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { type JSX, useEffect, useRef, useState } from "react";
import { formFieldElementId } from "../../conversation/open-resource.ts";
import { FORM_VIEWER_CONFIG } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { type PositionedField, positionPageFields } from "./geometry.ts";
import { renderFormPage } from "./pdf.ts";
import { fieldCitation } from "./provenance.ts";
import styles from "./viewer.module.css";

export interface FormPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  instance: ViewerInstance;
  language: FormViewerLanguage;
  preview: Record<string, TypePayload>;
  activeField: string | null;
  largeCursor: boolean;
  cursorSize?: number;
  elements: Map<string, HTMLElement>;
  onReady: (pageNumber: number) => void;
  onError: () => void;
  onEdit: (fieldId: string) => void;
}

export function FormPage(props: FormPageProps): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [fields, setFields] = useState<PositionedField[]>([]);
  const copy = formViewerCopy[props.language];
  const { document, pageNumber, instance, onReady, onError, zoom } = props;
  useEffect(() => {
    let disposed = false;
    let cancel: (() => void) | undefined;
    void (async () => {
      try {
        const loaded = await document.getPage(pageNumber);
        const positions = await positionPageFields(loaded, instance.schema.fields);
        if (disposed || !canvas.current) return;
        setPage(loaded);
        setFields(positions);
        const render = renderFormPage(loaded, canvas.current, zoom);
        cancel = render.cancel;
        await render.done;
        if (!disposed) onReady(pageNumber);
      } catch {
        if (!disposed) onError();
      }
    })();
    return () => {
      disposed = true;
      cancel?.();
    };
  }, [document, pageNumber, instance.schema.fields, zoom, onReady, onError]);
  const viewport = page?.getViewport({ scale: zoom });
  return (
    <section className={styles.pageSection} aria-label={`${copy.page} ${pageNumber}`}>
      <div className={styles.page} style={{ width: viewport?.width, height: viewport?.height }}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${copy.page} ${pageNumber}`}
          className={styles.canvas}
        />
        {fields.map(({ field, bounds }) => {
          const value = instance.fields[field.id];
          const preview = props.preview[field.id];
          const label = field.labels[props.language] ?? field.label_de;
          const active = props.activeField === field.id;
          return (
            <div
              key={`${field.id}-${bounds.x}-${bounds.y}`}
              id={formFieldElementId(field.id)}
              className={styles.field}
              data-active={active || undefined}
              style={{
                left: `${bounds.x * 100}%`,
                top: `${bounds.y * 100}%`,
                width: `${bounds.width * 100}%`,
                height: `${bounds.height * 100}%`,
              }}
              ref={(element) => {
                if (element) props.elements.set(field.id, element);
                else props.elements.delete(field.id);
              }}
            >
              <FormFieldOverlay
                label={label}
                value={preview?.value ?? String(value?.value ?? "")}
                state={preview ? "draft" : (value?.state ?? "draft")}
                source={fieldCitation(
                  field.id,
                  preview?.provenance ?? value?.provenance,
                  props.language,
                )}
                labels={{ draft: copy.draft, confirmed: copy.confirmed }}
                bounds={{ x: 0, y: 0, width: 1, height: 1 }}
              />
              {isEditableField(field) && (
                <button
                  type="button"
                  className={styles.fieldEdit}
                  aria-label={`${copy.edit}: ${label}`}
                  onClick={() => props.onEdit(field.id)}
                />
              )}
              {active && (
                <span
                  aria-hidden="true"
                  className={styles.cursor}
                  style={{
                    width: props.largeCursor
                      ? Math.max(
                          FORM_VIEWER_CONFIG.largeCursorSize,
                          props.cursorSize ?? FORM_VIEWER_CONFIG.cursorSize,
                        )
                      : (props.cursorSize ?? FORM_VIEWER_CONFIG.cursorSize),
                    height: props.largeCursor
                      ? Math.max(
                          FORM_VIEWER_CONFIG.largeCursorSize,
                          props.cursorSize ?? FORM_VIEWER_CONFIG.cursorSize,
                        )
                      : (props.cursorSize ?? FORM_VIEWER_CONFIG.cursorSize),
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
