"use client";

import type { JSX, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR } from "../config";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import type { MaterialVariant } from "../tokens/index";
import { Button, Heading } from "./primitives";

export interface DialogProps extends LabelProps {
  variant?: MaterialVariant;
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

function isAvailable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.closest(":disabled, [hidden], [inert], [aria-hidden='true']"))
    return false;
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden") return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isAvailable);
}

/** Restore prior state rather than assuming background content was interactive. */
function isolateDialog(root: HTMLElement): () => void {
  const background = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && element !== root,
  );
  const previous = background.map((element) => ({
    element,
    inert: element.inert || element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));
  const overflow = document.body.style.overflow;
  for (const element of background) {
    element.inert = true;
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  }
  document.body.style.overflow = "hidden";
  return () => {
    for (const { element, inert, ariaHidden } of previous) {
      element.inert = inert;
      if (!inert) element.removeAttribute("inert");
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    }
    document.body.style.overflow = overflow;
  };
}

function loopFocus(event: KeyboardEvent, root: HTMLElement): void {
  const focusable = focusableElements(root);
  const first = focusable.at(0) ?? root;
  const last = focusable.at(-1) ?? root;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === root)
  ) {
    event.preventDefault();
    first.focus();
  }
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  labels,
  variant = "glass",
}: DialogProps): JSX.Element | null {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    const opener = document.activeElement;
    (focusableElements(root).at(0) ?? root).focus();
    const restoreBackground = isolateDialog(root);
    const keydown = (event: KeyboardEvent): void => {
      if (root.closest("[inert]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") loopFocus(event, root);
    };
    const containFocus = (event: FocusEvent): void => {
      if (
        !root.closest("[inert]") &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        (focusableElements(root).at(0) ?? root).focus();
      }
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", containFocus);
      restoreBackground();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);
  const copy = { ...de, ...labels };
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={rootRef} className="lotse-dialog-backdrop">
      <div
        className="lotse-dialog"
        data-material={variant}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
      >
        <Button variant="ghost" onClick={onClose}>
          {copy.close}
        </Button>
        <Heading id={`${id}-title`}>{title}</Heading>
        {description && <p id={`${id}-description`}>{description}</p>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
