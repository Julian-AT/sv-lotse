"use client";

import type { JSX, KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import { Button } from "./primitives";

export interface TooltipProps extends LabelProps {
  label?: string;
  content: string;
}
/** Supplemental text only. Put interactive content in Disclosure or Dialog instead. */
export function Tooltip({ label, content, labels }: TooltipProps): JSX.Element {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const copy = { ...de, ...labels };
  const visible = (hovered || focused) && !dismissed;
  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setDismissed(true);
      }
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [visible]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The hover region keeps supplemental text reachable; its button supplies keyboard interaction.
    <span
      className="lotse-tooltip"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <Button
        variant="ghost"
        aria-describedby={visible ? id : undefined}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
      >
        {label ?? copy.help}
      </Button>
      {visible && (
        <span id={id} role="tooltip" className="lotse-tooltip-content">
          {content}
        </span>
      )}
    </span>
  );
}

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  label: string;
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

function nextTab(key: string, current: number, count: number): number | undefined {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  return undefined;
}

export function Tabs({ label, items, value, defaultValue, onValueChange }: TabsProps): JSX.Element {
  const id = useId();
  const enabled = items.filter((item) => !item.disabled);
  const [internalValue, setInternalValue] = useState(defaultValue ?? enabled[0]?.id);
  const requested = value ?? internalValue;
  const selected = enabled.find((item) => item.id === requested)?.id ?? enabled[0]?.id;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const select = (itemId: string): void => {
    if (value === undefined) setInternalValue(itemId);
    onValueChange?.(itemId);
  };
  const keydown = (event: KeyboardEvent<HTMLButtonElement>, itemId: string): void => {
    const index = nextTab(
      event.key,
      enabled.findIndex((item) => item.id === itemId),
      enabled.length,
    );
    const next = index === undefined ? undefined : enabled[index];
    if (!next) return;
    event.preventDefault();
    select(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div className="lotse-tabs">
      <div role="tablist" aria-label={label} className="lotse-tablist">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="lotse-tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={item.id === selected}
            tabIndex={item.id === selected ? 0 : -1}
            disabled={item.disabled}
            ref={(element) => {
              if (element) refs.current.set(item.id, element);
              else refs.current.delete(item.id);
            }}
            onClick={() => select(item.id)}
            onKeyDown={(event) => keydown(event, item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: APG tab panels need a keyboard stop when their content is not focusable.
          tabIndex={0}
          hidden={item.id !== selected}
          className="lotse-tabpanel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

export interface DisclosureProps {
  summary: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
export function Disclosure({
  summary,
  children,
  open,
  onOpenChange,
}: DisclosureProps): JSX.Element {
  return (
    <details
      className="lotse-disclosure"
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}
