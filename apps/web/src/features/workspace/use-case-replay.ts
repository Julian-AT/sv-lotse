"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadCaseReplay, type TimelineItem } from "./case-record.ts";
import { CASE_REPLAY_STEP_MS } from "./config.ts";

export type ReplayState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "open"; frames: TimelineItem[]; index: number; playing: boolean };

function move(current: ReplayState, delta: number, playing: boolean): ReplayState {
  if (current.status !== "open") return current;
  const last = current.frames.length - 1;
  const index = Math.min(Math.max(current.index + delta, 0), Math.max(last, 0));
  return { ...current, index, playing: playing && index < last };
}

/** FR-K4: steps through the recorded case from GET /replay; it never executes anything. */
export function useCaseReplay(caseId: string): {
  state: ReplayState;
  open: () => Promise<void>;
  close: () => void;
  next: () => void;
  previous: () => void;
  toggle: () => void;
} {
  const [state, setState] = useState<ReplayState>({ status: "closed" });
  const request = useRef<AbortController | null>(null);
  const playing = state.status === "open" && state.playing;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setState((current) => move(current, 1, true)),
      CASE_REPLAY_STEP_MS,
    );
    return () => clearInterval(timer);
  }, [playing]);
  const open = useCallback(async (): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const frames = await loadCaseReplay(caseId, controller.signal);
      if (!controller.signal.aborted)
        setState({ status: "open", frames, index: 0, playing: frames.length > 1 });
    } catch {
      if (!controller.signal.aborted) setState({ status: "error" });
    }
  }, [caseId]);
  const close = useCallback((): void => {
    request.current?.abort();
    setState({ status: "closed" });
  }, []);
  const next = useCallback(() => setState((current) => move(current, 1, false)), []);
  const previous = useCallback(() => setState((current) => move(current, -1, false)), []);
  const toggle = useCallback(
    () =>
      setState((current) => {
        if (current.status !== "open") return current;
        if (current.playing) return { ...current, playing: false };
        const atEnd = current.index >= current.frames.length - 1;
        return { ...current, index: atEnd ? 0 : current.index, playing: current.frames.length > 1 };
      }),
    [],
  );
  return { state, open, close, next, previous, toggle };
}
