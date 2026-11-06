"use client";

import {
  type FieldCorrection,
  isEditableField,
  isValidFieldValue,
  type ViewerField,
  type ViewerInstance,
  type ViewerValue,
} from "@lotse/brain/forms/viewer/schema";
import { CitationChip } from "@lotse/ui";
import { type JSX, useEffect, useRef, useState } from "react";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { fieldCitation } from "./provenance.ts";
import styles from "./viewer.module.css";

interface FieldRowProps {
  field: ViewerField;
  value: ViewerValue | undefined;
  language: FormViewerLanguage;
  editing: boolean;
  onEdit: (fieldId: string | null) => void;
  onSave: (input: FieldCorrection) => Promise<void>;
}
function FieldRow({ field, value, language, editing, onEdit, onSave }: FieldRowProps): JSX.Element {
  const copy = formViewerCopy[language];
  const label = field.labels[language] ?? field.label_de;
  const [draft, setDraft] = useState<FieldCorrection["value"]>(value?.value ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  const finish = (): void => {
    onEdit(null);
    editButton.current?.focus();
  };
  const save = async (): Promise<void> => {
    setPending(true);
    setError(false);
    try {
      await onSave({ fieldId: field.id, value: draft });
      finish();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  const editable = isEditableField(field);
  const valid = value && isValidFieldValue(field, value.value ?? "");
  const source = fieldCitation(field.id, value?.provenance, language);
  const inputId = `form-edit-${field.id}`;
  return (
    <li className={styles.fieldRow} id={`form-source-${field.id}`}>
      <strong>{label}</strong>
      <span>{value?.state === "confirmed" ? copy.confirmed : copy.draft}</span>
      <p>{String(value?.value ?? "")}</p>
      {!editable ? (
        <p>{copy.reserved}</p>
      ) : !value || value.value === "" || value.value === null ? (
        <p>{copy.missing}</p>
      ) : !valid ? (
        <p>{copy.invalid}</p>
      ) : null}
      {value && (
        <>
          <CitationChip source={source} />
          <blockquote>{source.quote}</blockquote>
        </>
      )}
      {editable && (
        <button
          type="button"
          ref={editButton}
          disabled={pending}
          onClick={() => {
            setDraft(value?.value ?? "");
            setError(false);
            onEdit(field.id);
          }}
        >
          {copy.edit}
        </button>
      )}
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          aria-busy={pending}
        >
          <label htmlFor={inputId}>{label}</label>
          {field.validation.options ? (
            <select
              id={inputId}
              value={String(draft)}
              disabled={pending}
              ref={(element) => {
                input.current = element;
              }}
              onChange={(event) => setDraft(event.target.value)}
            >
              <option value="">{copy.missing}</option>
              {field.validation.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={inputId}
              ref={(element) => {
                input.current = element;
              }}
              disabled={pending}
              type={
                field.type === "checkbox"
                  ? "checkbox"
                  : field.type === "date"
                    ? "date"
                    : field.type === "number"
                      ? "number"
                      : "text"
              }
              value={field.type === "checkbox" ? undefined : String(draft)}
              checked={field.type === "checkbox" ? draft === true : undefined}
              onChange={(event) =>
                setDraft(field.type === "checkbox" ? event.target.checked : event.target.value)
              }
              required={field.validation.required}
              min={field.validation.min}
              max={field.validation.max}
              minLength={field.validation.min_length}
              maxLength={field.validation.max_length}
              pattern={field.validation.pattern}
              aria-invalid={error || undefined}
            />
          )}
          <button type="submit" disabled={pending}>
            {copy.save}
          </button>
          <button type="button" disabled={pending} onClick={finish}>
            {copy.cancel}
          </button>
          {error && <p role="alert">{copy.saveError}</p>}
        </form>
      )}
    </li>
  );
}

export function FormFieldList(props: {
  instance: ViewerInstance;
  language: FormViewerLanguage;
  editing: string | null;
  onEdit: (id: string | null) => void;
  onSave: (input: FieldCorrection) => Promise<void>;
}): JSX.Element {
  const copy = formViewerCopy[props.language];
  return (
    <section aria-label={copy.fields} className={styles.fieldList}>
      <h2>{copy.fields}</h2>
      <ul>
        {props.instance.schema.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            value={props.instance.fields[field.id]}
            language={props.language}
            editing={props.editing === field.id}
            onEdit={props.onEdit}
            onSave={props.onSave}
          />
        ))}
      </ul>
    </section>
  );
}
