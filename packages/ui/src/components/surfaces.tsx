"use client";

import type { HTMLAttributes, JSX } from "react";
import { useId } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import type { MaterialVariant } from "../tokens/index";
import type { Tone } from "./primitives";
import { Heading, IconButton } from "./primitives";

export type PanelProps = HTMLAttributes<HTMLElement> & {
  title: string;
  variant?: MaterialVariant;
};

export function Panel({
  title,
  variant = "glass",
  className = "",
  children,
  ...props
}: PanelProps): JSX.Element {
  const id = useId();
  return (
    <section
      {...props}
      className={`lotse-panel ${className}`}
      data-material={variant}
      aria-labelledby={id}
    >
      <Heading id={id}>{title}</Heading>
      {children}
    </section>
  );
}

export type NavigationBarProps = HTMLAttributes<HTMLElement> & {
  label: string;
  variant?: MaterialVariant;
};

export function NavigationBar({
  label,
  variant = "glass",
  className = "",
  ...props
}: NavigationBarProps): JSX.Element {
  return (
    <nav
      {...props}
      className={`lotse-navigation ${className}`}
      data-material={variant}
      aria-label={label}
    />
  );
}

export type ToastProps = HTMLAttributes<HTMLDivElement> &
  LabelProps & {
    tone?: Tone;
    variant?: MaterialVariant;
    onDismiss?: () => void;
  };

/** Caller owns lifetime: messages stay available until explicitly dismissed. */
export function Toast({
  tone = "info",
  variant = "glass",
  onDismiss,
  labels,
  className = "",
  children,
  ...props
}: ToastProps): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <div {...props} className={`lotse-toast ${className}`} data-material={variant} data-tone={tone}>
      <div role={tone === "error" ? "alert" : "status"} aria-atomic="true">
        <strong className="lotse-toast-label">{copy[tone]}</strong>
        {children}
      </div>
      {onDismiss && (
        <IconButton label={copy.close} variant="ghost" onClick={onDismiss}>
          <span className="lotse-remove-mark" />
        </IconButton>
      )}
    </div>
  );
}
