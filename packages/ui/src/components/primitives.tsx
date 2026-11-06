"use client";

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  JSX,
  ReactNode,
} from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import type { Space } from "../tokens/index";
import { safeHref } from "../url";

export type Tone = "info" | "success" | "warning" | "error";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  LabelProps & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    loading?: boolean;
  };

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  labels,
  className = "",
  type = "button",
  ...props
}: ButtonProps): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <button
      {...props}
      type={type}
      className={`lotse-button ${className}`}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="lotse-spinner-mark" aria-hidden="true" />}
      {children}
      {loading && <VisuallyHidden>{copy.loading}</VisuallyHidden>}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "aria-label"> & { label: string };
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: IconButtonProps): JSX.Element {
  return (
    <Button {...props} className={`lotse-icon-button ${className}`} aria-label={label}>
      <span aria-hidden="true">{children}</span>
    </Button>
  );
}

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
export function Link({ href, className = "", rel, target, ...props }: LinkProps): JSX.Element {
  return (
    <a
      {...props}
      href={safeHref(href)}
      target={target}
      rel={target === "_blank" ? `${rel ?? ""} noopener noreferrer` : rel}
      className={`lotse-link ${className}`}
    />
  );
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div {...props} className={`lotse-card ${className}`} />;
}

type LayoutProps = HTMLAttributes<HTMLDivElement> & { gap?: Space };
export function Stack({
  gap = "medium",
  className = "",
  style,
  ...props
}: LayoutProps): JSX.Element {
  return (
    <div
      {...props}
      className={`lotse-stack ${className}`}
      style={{ gap: `var(--lotse-space-${gap})`, ...style }}
    />
  );
}
export function Inline({
  gap = "medium",
  className = "",
  style,
  ...props
}: LayoutProps): JSX.Element {
  return (
    <div
      {...props}
      className={`lotse-inline ${className}`}
      style={{ gap: `var(--lotse-space-${gap})`, ...style }}
    />
  );
}

export function Heading({
  level = 2,
  className = "",
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }): JSX.Element {
  const Element: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" = `h${level}`;
  return <Element {...props} className={`lotse-heading ${className}`} />;
}
export function Text({
  tone,
  className = "",
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: "muted" }): JSX.Element {
  return <p {...props} className={`lotse-text ${className}`} data-tone={tone} />;
}
export function Badge({
  tone = "info",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }): JSX.Element {
  return <span {...props} className={`lotse-badge ${className}`} data-tone={tone} />;
}
export function Tag({
  children,
  onRemove,
  labels,
}: LabelProps & { children: string; onRemove?: () => void }): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <span className="lotse-tag">
      {children}
      {onRemove && (
        <IconButton variant="ghost" label={`${copy.remove}: ${children}`} onClick={onRemove}>
          <span className="lotse-remove-mark" />
        </IconButton>
      )}
    </span>
  );
}
export function Alert({
  tone = "info",
  children,
  labels,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & LabelProps & { tone?: Tone }): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <div
      {...props}
      className={`lotse-alert ${className}`}
      data-tone={tone}
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
    >
      <strong>{copy[tone]}</strong>
      <div>{children}</div>
    </div>
  );
}
export function Spinner({ labels }: LabelProps): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <span role="status" className="lotse-spinner">
      <span className="lotse-spinner-mark" aria-hidden="true" />
      <VisuallyHidden>{copy.loading}</VisuallyHidden>
    </span>
  );
}
export function Skeleton({ labels }: LabelProps): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <div role="status" className="lotse-skeleton">
      <VisuallyHidden>{copy.loading}</VisuallyHidden>
    </div>
  );
}
export function VisuallyHidden({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }): JSX.Element {
  return (
    <span {...props} className={`lotse-visually-hidden ${className}`}>
      {children}
    </span>
  );
}
