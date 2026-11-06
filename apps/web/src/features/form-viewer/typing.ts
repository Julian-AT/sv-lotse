import type { TypePayload } from "@lotse/protocol";

function waitForKeystroke(pace: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, pace);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Transient display only. form.fillLive owns draft persistence; this never confirms a value. */
export async function typeFieldValue(
  payload: TypePayload,
  options: {
    signal: AbortSignal;
    reducedMotion: boolean;
    paceMultiplier: number;
    onValue: (value: string) => void;
  },
): Promise<void> {
  options.signal.throwIfAborted();
  options.onValue("");
  if (options.reducedMotion) {
    options.onValue(payload.value);
    return;
  }
  // Grapheme boundaries preserve combining accents and emoji as one readable keystroke.
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    payload.value,
  );
  let value = "";
  for (const { segment } of segments) {
    await waitForKeystroke(payload.pace * options.paceMultiplier, options.signal);
    options.signal.throwIfAborted();
    value += segment;
    options.onValue(value);
  }
}
