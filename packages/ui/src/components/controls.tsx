"use client";

import type { InputHTMLAttributes, JSX, ReactNode, SelectHTMLAttributes } from "react";
import { createContext, useContext, useId } from "react";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | undefined>(undefined);
export interface FieldProps {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** One control per Field. The context wires label, hint and validation without cloning children. */
export function Field({ id, label, hint, error, children }: FieldProps): JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy =
    [hint ? `${fieldId}-hint` : undefined, error ? `${fieldId}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <FieldContext value={{ id: fieldId, describedBy, invalid: Boolean(error) }}>
      <div className="lotse-field">
        <label htmlFor={fieldId}>{label}</label>
        {hint && (
          <p className="lotse-hint" id={`${fieldId}-hint`}>
            {hint}
          </p>
        )}
        {children}
        {error && (
          <p className="lotse-field-error" id={`${fieldId}-error`}>
            {error}
          </p>
        )}
      </div>
    </FieldContext>
  );
}

function useFieldAttributes(
  id?: string,
  describedBy?: string,
): {
  id: string | undefined;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
} {
  const field = useContext(FieldContext);
  return {
    id: field?.id ?? id,
    "aria-describedby": [field?.describedBy, describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": field?.invalid || undefined,
  };
}

export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const attributes = useFieldAttributes(props.id, props["aria-describedby"]);
  return (
    <input
      {...props}
      {...attributes}
      aria-invalid={attributes["aria-invalid"] ?? props["aria-invalid"]}
      className={`lotse-input ${className}`}
    />
  );
}
export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  const attributes = useFieldAttributes(props.id, props["aria-describedby"]);
  return (
    <select
      {...props}
      {...attributes}
      aria-invalid={attributes["aria-invalid"] ?? props["aria-invalid"]}
      className={`lotse-select ${className}`}
    />
  );
}

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  label: string;
};
function Choice({
  type,
  label,
  id,
  className = "",
  ...props
}: ChoiceProps & { type: "checkbox" | "radio" }): JSX.Element {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <label className={`lotse-choice ${className}`} htmlFor={controlId}>
      <input {...props} id={controlId} type={type} />
      <span>{label}</span>
    </label>
  );
}
export function Checkbox(props: ChoiceProps): JSX.Element {
  return <Choice {...props} type="checkbox" />;
}
export function Radio(props: ChoiceProps): JSX.Element {
  return <Choice {...props} type="radio" />;
}
