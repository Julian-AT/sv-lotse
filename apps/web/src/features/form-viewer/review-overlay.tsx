"use client";

import type { ReviewedField } from "@lotse/brain/forms/registry/schema";
import { type JSX, type KeyboardEvent, type PointerEvent, useRef } from "react";
import type { FormViewerLanguage } from "./copy.ts";
import { reviewCopy } from "./review-copy.ts";
import { constrainReviewBox, keyReviewBox, type ReviewPageSize } from "./review-geometry.ts";
import styles from "./viewer.module.css";

type Gesture = {
  start: { x: number; y: number };
  field: ReviewedField;
  kind: "move" | "resize" | "draw";
};
export interface ReviewOverlayProps {
  page: number;
  size: ReviewPageSize;
  fields: readonly ReviewedField[];
  selected: string | null;
  confirmed: ReadonlySet<string>;
  drawing: boolean;
  language: FormViewerLanguage;
  onSelect: (id: string) => void;
  onChange: (field: ReviewedField) => void;
  onAdd: (box: ReviewedField["box"]) => ReviewedField;
}
export function ReviewOverlay(props: ReviewOverlayProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const copy = reviewCopy[props.language];
  const point = (event: PointerEvent): { x: number; y: number } => {
    const rect = root.current?.getBoundingClientRect();
    return {
      x: rect?.width ? ((event.clientX - rect.left) * props.size.width) / rect.width : 0,
      y: rect?.height ? ((event.clientY - rect.top) * props.size.height) / rect.height : 0,
    };
  };
  const start = (
    event: PointerEvent<HTMLButtonElement>,
    field: ReviewedField,
    kind: Gesture["kind"],
  ): void => {
    if (event.button !== 0) return;
    props.onSelect(field.id);
    gesture.current = { start: point(event), field, kind };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>): void => {
    const active = gesture.current;
    if (!active) return;
    const current = point(event);
    const dx = current.x - active.start.x;
    const dy = current.y - active.start.y;
    const box = active.field.box;
    const next =
      active.kind === "move"
        ? { ...box, x: box.x + dx, y: box.y + dy }
        : active.kind === "resize"
          ? { ...box, width: box.width + dx, height: box.height + dy }
          : {
              ...box,
              x: Math.min(active.start.x, current.x),
              y: Math.min(active.start.y, current.y),
              width: Math.abs(dx),
              height: Math.abs(dy),
            };
    props.onChange({ ...active.field, box: constrainReviewBox(next, props.size) });
  };
  const end = (): void => {
    gesture.current = null;
  };
  const cancel = (): void => {
    if (gesture.current) props.onChange(gesture.current.field);
    end();
  };
  const keyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    field: ReviewedField,
    resize = false,
  ): void => {
    if (event.key === "Escape") {
      cancel();
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    props.onChange({
      ...field,
      box: keyReviewBox(field.box, event.key, resize || event.shiftKey, props.size),
    });
  };
  return (
    <div ref={root} className={styles.reviewOverlay}>
      {props.drawing && (
        <button
          type="button"
          className={styles.drawSurface}
          aria-label={copy.surface}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const location = point(event);
            const field = props.onAdd(
              constrainReviewBox(
                { page: props.page, ...location, width: 2, height: 2 },
                props.size,
              ),
            );
            start(event, field, "draw");
          }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={cancel}
        />
      )}
      {props.fields
        .filter((field) => field.box.page === props.page)
        .map((field) => (
          <div
            key={field.id}
            className={styles.reviewBox}
            data-selected={props.selected === field.id || undefined}
            data-confirmed={props.confirmed.has(field.id) || undefined}
            style={{
              left: `${(field.box.x / props.size.width) * 100}%`,
              top: `${(field.box.y / props.size.height) * 100}%`,
              width: `${(field.box.width / props.size.width) * 100}%`,
              height: `${(field.box.height / props.size.height) * 100}%`,
            }}
          >
            <button
              type="button"
              className={styles.reviewMove}
              aria-label={field.label_de}
              aria-pressed={props.selected === field.id}
              onClick={() => props.onSelect(field.id)}
              onKeyDown={(event) => keyboard(event, field)}
              onPointerDown={(event) => start(event, field, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={cancel}
            >
              {field.label_de}
              <span className={styles.reviewBadge}>
                {props.confirmed.has(field.id) ? copy.confirmed : copy.pending}
              </span>
            </button>
            {props.selected === field.id && (
              <button
                type="button"
                className={styles.reviewResize}
                aria-label={`${copy.resize}: ${field.label_de}`}
                onKeyDown={(event) => keyboard(event, field, true)}
                onPointerDown={(event) => start(event, field, "resize")}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={cancel}
              >
                ↘
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
