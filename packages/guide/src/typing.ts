export type TextField = HTMLInputElement | HTMLTextAreaElement;
export type Guard = () => string | undefined;

export function textField(element: Element): TextField | undefined {
  if (element.localName === "textarea") return element as HTMLTextAreaElement;
  if (
    element.localName === "input" &&
    ["text", "search", "email", "url", "tel"].includes((element as HTMLInputElement).type)
  )
    return element as HTMLInputElement;
  return;
}

function delay(document: Document, pace: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const view = document.defaultView;
    if (!view || signal.aborted) {
      resolve();
      return;
    }
    const abort = () => {
      view.clearTimeout(timer);
      resolve();
    };
    const timer = view.setTimeout(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      Math.min(pace, 2147483647),
    );
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function typeVisible(
  field: TextField,
  value: string,
  pace: number,
  guard: Guard,
  signal: AbortSignal,
): Promise<string | undefined> {
  const document = field.ownerDocument;
  const window = document.defaultView;
  if (!window) return "target-not-found";
  const view = window;
  const prototype =
    field.localName === "textarea"
      ? view.HTMLTextAreaElement.prototype
      : view.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!nativeSetter) return "unsupported-field";
  const setter = nativeSetter;
  if (field.localName === "input" && /[\r\n]/u.test(value)) return "unsupported-value";
  const check = () =>
    signal.aborted
      ? "interrupted"
      : (guard() ??
        (field.readOnly ||
        field.matches(":disabled") ||
        field.getAttribute("aria-disabled") === "true" ||
        field.getAttribute("aria-readonly") === "true"
          ? "not-editable"
          : undefined));
  const initialFailure = check();
  if (initialFailure) return initialFailure;
  let expected = field.value;
  let changed = false;
  let userInteracted = false;
  const onInteraction = (event: Event) => {
    if (event.isTrusted) userInteracted = true;
  };
  const onBlur = () => {
    if (changed) {
      changed = false;
      field.dispatchEvent(new view.Event("change", { bubbles: true, composed: true }));
    }
  };
  for (const type of ["keydown", "pointerdown", "beforeinput"])
    document.addEventListener(type, onInteraction, true);
  field.addEventListener("blur", onBlur);
  let finalFailure: string | undefined;
  try {
    field.focus({ preventScroll: true });
    function preflight(): string | undefined {
      return (
        check() ??
        (userInteracted || document.activeElement !== field ? "interrupted" : undefined) ??
        (field.value !== expected ? "value-changed" : undefined)
      );
    }
    function edit(
      next: string,
      data: string | null,
      inputType: string,
      key: string,
    ): string | undefined {
      const failure = preflight();
      if (failure) return failure;
      const keyboard = (type: string) =>
        new view.KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true });
      if (!field.dispatchEvent(keyboard("keydown"))) {
        field.dispatchEvent(keyboard("keyup"));
        return "input-cancelled";
      }
      try {
        const beforeFailure = preflight();
        if (beforeFailure) return beforeFailure;
        if (
          !field.dispatchEvent(
            new view.InputEvent("beforeinput", {
              data,
              inputType,
              bubbles: true,
              composed: true,
              cancelable: true,
            }),
          )
        )
          return "input-cancelled";
        const afterFailure = preflight();
        if (afterFailure) return afterFailure;
        setter.call(field, next);
        expected = next;
        changed = true;
        field.dispatchEvent(
          new view.InputEvent("input", { data, inputType, bubbles: true, composed: true }),
        );
        return preflight();
      } finally {
        field.dispatchEvent(keyboard("keyup"));
      }
    }
    if (expected !== "") {
      const failure = edit("", null, "deleteContentBackward", "Backspace");
      if (failure) return failure;
    }
    for (const character of value) {
      if (pace > 0) await delay(document, pace, signal);
      const failure = edit(
        expected + character,
        character,
        character === "\n" ? "insertLineBreak" : "insertText",
        character === "\n" ? "Enter" : character,
      );
      if (failure) return failure;
    }
    finalFailure = preflight();
  } finally {
    // Programmatic native setters do not synthesize a browser change event.
    if (document.activeElement === field) field.blur();
    field.removeEventListener("blur", onBlur);
    for (const type of ["keydown", "pointerdown", "beforeinput"])
      document.removeEventListener(type, onInteraction, true);
  }
  // Portals can normalize or reject the approved value in blur/change handlers.
  return finalFailure ?? check() ?? (field.value !== value ? "value-changed" : undefined);
}
