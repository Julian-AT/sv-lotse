"use client";
import { type ReviewedField, ReviewedFieldSchema } from "@lotse/brain/forms/registry/schema";
import type { JSX } from "react";
import type { FormViewerLanguage } from "./copy.ts";
import { reviewCopy } from "./review-copy.ts";
import { constrainReviewBox, type ReviewPageSize } from "./review-geometry.ts";
import styles from "./viewer.module.css";

export function ReviewFieldEditor(props: {
  field: ReviewedField;
  pages: readonly ReviewPageSize[];
  language: FormViewerLanguage;
  confirmed: boolean;
  onChange: (field: ReviewedField) => void;
  onConfirm: () => void;
  onRemove: () => void;
}): JSX.Element {
  const { field, onChange } = props;
  const copy = reviewCopy[props.language];
  return (
    <fieldset className={styles.reviewEditor}>
      <legend>{field.label_de || copy.label}</legend>
      <label>
        {copy.label}
        <input
          value={field.label_de}
          onChange={(event) => onChange({ ...field, label_de: event.target.value })}
        />
      </label>
      <label>
        {copy.type}
        <select
          value={field.type}
          onChange={(event) =>
            onChange({ ...field, type: ReviewedFieldSchema.shape.type.parse(event.target.value) })
          }
        >
          {Object.entries(copy.types).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.owner}
        <select
          value={field.owner}
          onChange={(event) =>
            onChange({ ...field, owner: ReviewedFieldSchema.shape.owner.parse(event.target.value) })
          }
        >
          {Object.entries(copy.owners).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {copy.page}
        <select
          value={field.box.page}
          onChange={(event) => {
            const page = Number(event.target.value);
            const size = props.pages[page - 1];
            if (size) onChange({ ...field, box: constrainReviewBox({ ...field.box, page }, size) });
          }}
        >
          {Array.from({ length: props.pages.length }, (_, index) => index + 1).map((page) => (
            <option key={page} value={page}>
              {page}
            </option>
          ))}
        </select>
      </label>
      {(["x", "y", "width", "height"] as const).map((key) => (
        <label key={key}>
          {copy[key]}
          <input
            type="number"
            step="1"
            min={key === "x" || key === "y" ? 0 : 2}
            value={Math.round(field.box[key] * 100) / 100}
            onChange={(event) => {
              const size = props.pages[field.box.page - 1];
              const value = event.target.valueAsNumber;
              if (size && Number.isFinite(value))
                onChange({
                  ...field,
                  box: constrainReviewBox({ ...field.box, [key]: value }, size),
                });
            }}
          />
        </label>
      ))}
      <button
        type="button"
        disabled={!field.label_de.trim() || props.confirmed}
        onClick={props.onConfirm}
      >
        {props.confirmed ? copy.confirmed : copy.confirm}
      </button>
      <button type="button" onClick={props.onRemove}>
        {copy.remove}
      </button>
    </fieldset>
  );
}
