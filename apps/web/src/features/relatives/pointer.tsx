"use client";
import { type Dispatch, type ReactElement, type SetStateAction, useState } from "react";
import { MAX_ANNOTATIONS } from "./config.ts";
import type { RelativesCopy } from "./copy.ts";
import type { PointerMessage } from "./messages.ts";
import styles from "./relatives.module.css";

export type PointerState = { cursor: PointerMessage | null; marks: PointerMessage[] };
export function updatePointer(state: PointerState, message: PointerMessage): PointerState {
  if (message.type === "clear") return { ...state, marks: [] };
  if (message.type === "leave") return { ...state, cursor: null };
  return {
    cursor: message,
    marks:
      message.type === "mark"
        ? [
            ...state.marks
              .filter((mark) => mark.x !== message.x || mark.y !== message.y)
              .slice(-(MAX_ANNOTATIONS - 1)),
            message,
          ]
        : state.marks,
  };
}
export function useHelperPointer(): [PointerState, Dispatch<SetStateAction<PointerState>>] {
  return useState<PointerState>({ cursor: null, marks: [] });
}
export function HelperPointer({
  state,
  copy,
}: {
  state: PointerState;
  copy: RelativesCopy;
}): ReactElement {
  return (
    <div>
      {state.cursor ? (
        <span
          className={styles.cursor}
          style={{ left: `${state.cursor.x * 100}%`, top: `${state.cursor.y * 100}%` }}
        >
          {copy.helper}
        </span>
      ) : null}
      {state.marks.map((mark) => (
        <span
          key={`${mark.x}-${mark.y}`}
          aria-hidden="true"
          data-helper-annotation
          className={styles.mark}
          style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
        />
      ))}
    </div>
  );
}
