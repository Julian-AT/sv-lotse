"use client";

import {
  isEditableField,
  isValidFieldValue,
  type ViewerInstance,
} from "@lotse/brain/forms/viewer/schema";
import { type Action, type ActionResult, ActionSchema, type TypePayload } from "@lotse/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { measureFieldTarget } from "./bridge.ts";
import { FORM_FILL_STOP_EVENT, FORM_VIEWER_CONFIG } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { typeFieldValue } from "./typing.ts";

type TypeAction = Extract<Action, { kind: "type" }>;
export interface LiveFillOptions {
  instance: ViewerInstance | null;
  actions: readonly Action[];
  ready: boolean;
  elements: Map<string, HTMLElement>;
  language: FormViewerLanguage;
  slow: boolean;
  cursorSpeed?: number;
  reducedMotion?: boolean;
  onTargetRect: (rect: ReturnType<typeof measureFieldTarget>) => void | Promise<void>;
  onActionResult?: ((result: ActionResult) => void) | undefined;
  /** Typed values are persisted drafts; reload them when typing ends or stops so they stay visible. */
  onSettled?: (() => void) | undefined;
}

export function useLiveFill(options: LiveFillOptions): {
  activeField: string | null;
  isFilling: boolean;
  preview: Record<string, TypePayload>;
  caption: string;
  stop: () => void;
} {
  const latest = useRef(options);
  latest.current = options;
  const queue = useRef<TypeAction[]>([]);
  const seen = useRef(new Set<string>());
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [isFilling, setIsFilling] = useState(false);
  const [preview, setPreview] = useState<Record<string, TypePayload>>({});
  const [caption, setCaption] = useState("");

  const stop = useCallback((): void => {
    controller.current?.abort();
    for (const action of queue.current)
      latest.current.onActionResult?.({
        actionId: action.id,
        resolvedBy: "ui",
        confidence: 1,
        success: false,
        failureReason: "USER_STOPPED",
      });
    queue.current = [];
    for (const action of latest.current.actions) {
      if (action.kind !== "type" || action.target.kind !== "form" || seen.current.has(action.id))
        continue;
      seen.current.add(action.id);
      latest.current.onActionResult?.({
        actionId: action.id,
        resolvedBy: "ui",
        confidence: 1,
        success: false,
        failureReason: "USER_STOPPED",
      });
    }
    setPreview({});
    setCaption(formViewerCopy[latest.current.language].stopped);
    latest.current.onSettled?.();
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setIsFilling(queue.current.length > 0);
    let filled = false;
    try {
      while (queue.current.length > 0) {
        const action = queue.current.shift();
        if (action?.target.kind !== "form") continue;
        const current = latest.current;
        const fieldId = action.target.fieldId;
        const field = current.instance?.schema.fields.find((item) => item.id === fieldId);
        const element = current.elements.get(fieldId);
        let failureReason: string | undefined;
        const aborter = new AbortController();
        controller.current = aborter;
        try {
          if (!field || !isEditableField(field) || !element) throw new Error("FIELD_UNAVAILABLE");
          const value =
            field.type === "checkbox" && ["true", "false"].includes(action.payload.value)
              ? action.payload.value === "true"
              : action.payload.value;
          if (!isValidFieldValue(field, value)) throw new Error("FIELD_INVALID");
          element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          element.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
          await current.onTargetRect(measureFieldTarget(fieldId, element));
          aborter.signal.throwIfAborted();
          setActiveField(fieldId);
          const copy = formViewerCopy[current.language];
          setCaption(
            `${copy.filling}: ${field.labels[current.language] ?? field.label_de} — ${action.payload.value}. ${copy.source}: ${action.payload.provenance.source.quote ?? (action.payload.provenance.source.kind === "document" ? copy.document : copy.statement)}`,
          );
          await typeFieldValue(action.payload, {
            signal: aborter.signal,
            reducedMotion:
              current.reducedMotion === true ||
              window.matchMedia(FORM_VIEWER_CONFIG.reducedMotionQuery).matches,
            paceMultiplier:
              (current.slow ? FORM_VIEWER_CONFIG.slowPaceMultiplier : 1) /
              (current.cursorSpeed ?? 1),
            onValue: (value) =>
              setPreview((previous) => ({ ...previous, [fieldId]: { ...action.payload, value } })),
          });
        } catch {
          failureReason = aborter.signal.aborted ? "USER_STOPPED" : "FIELD_UNAVAILABLE";
        } finally {
          setActiveField(null);
          controller.current = null;
        }
        filled ||= !failureReason;
        current.onActionResult?.({
          actionId: action.id,
          resolvedBy: "ui",
          confidence: failureReason ? 0 : 1,
          success: !failureReason,
          ...(failureReason ? { failureReason } : {}),
        });
      }
    } finally {
      busy.current = false;
      setIsFilling(false);
    }
    if (filled) latest.current.onSettled?.();
  }, []);

  useEffect(() => {
    if (!options.ready || !options.instance) return;
    for (const input of options.actions) {
      const parsed = ActionSchema.safeParse(input);
      if (!parsed.success) continue;
      const action = parsed.data;
      if (
        seen.current.has(action.id) ||
        action.kind !== "type" ||
        action.target.kind !== "form" ||
        action.target.formInstanceId !== options.instance.id
      )
        continue;
      seen.current.add(action.id);
      queue.current.push(action);
    }
    void run();
  }, [options.actions, options.ready, options.instance, run]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (
        event.key === "Escape" ||
        (busy.current && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey)
      )
        stop();
    };
    window.addEventListener("keydown", onEscape);
    window.addEventListener(FORM_FILL_STOP_EVENT, stop);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener(FORM_FILL_STOP_EVENT, stop);
      controller.current?.abort();
      queue.current = [];
    };
  }, [stop]);

  // A persisted correction/confirmation supersedes transient animation display.
  useEffect(() => {
    if (options.instance) setPreview((previous) => (Object.keys(previous).length ? {} : previous));
  }, [options.instance]);
  return { activeField, isFilling, preview, caption, stop };
}
