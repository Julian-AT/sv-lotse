import { workspaceTargets } from "@lotse/brain/workspace/targets";
import { type Action, PROTOCOL_VERSION, type Target, type TargetRect } from "@lotse/protocol";
import { hasNativeBridge, postNative } from "../bridge/index.ts";
import { measureFieldTarget } from "../features/form-viewer/bridge.ts";
import { formFieldElementId } from "./open-resource.ts";

export const NATIVE_POINTER_CONFIG = {
  /** The native resolver keeps a rectangle for 3 s; refresh well within that while speaking. */
  refreshMs: 700,
  trackMs: 20_000,
} as const;

const normalize = (text: string): string => text.replace(/\s+/gu, " ").trim().toLowerCase();

/** The smallest visible workspace element whose text contains the quote. */
function quoteElement(quote: string, root: Document): HTMLElement | undefined {
  const wanted = normalize(quote);
  if (!wanted) return;
  const walker = root.createTreeWalker(root.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let element = node.parentElement;
    // Grow from the text node until the quote fits (quotes may span inline markup).
    for (let depth = 0; element && depth < 4; depth++, element = element.parentElement) {
      if (normalize(element.textContent ?? "").includes(wanted)) {
        if (element.closest("[aria-hidden='true']")) break;
        return element;
      }
      if ((element.textContent ?? "").length > wanted.length * 20) break;
    }
  }
  return;
}

/** Workspace element for a display target, if it lives on this page. */
export function workspaceElement(
  target: Target,
  root: Document = document,
): HTMLElement | undefined {
  switch (target.kind) {
    case "ui": {
      const element = root.getElementById(target.elementId);
      if (element || !target.elementId.startsWith(workspaceTargets.resultPrefix))
        return element ?? undefined;
      // A tool without a result card still shows its tool row.
      const callId = target.elementId.slice(workspaceTargets.resultPrefix.length);
      return root.getElementById(workspaceTargets.toolRow(callId)) ?? undefined;
    }
    case "form":
      return root.getElementById(formFieldElementId(target.fieldId)) ?? undefined;
    case "text":
      return target.documentId ? undefined : quoteElement(target.quote, root);
    case "dom":
      return undefined;
    default:
      return undefined;
  }
}

const tracked = new Map<string, ReturnType<typeof setInterval>>();
export function stopNativePointing(): void {
  for (const timer of tracked.values()) clearInterval(timer);
  tracked.clear();
}

function envelope(type: "TargetRect" | "Action", payload: TargetRect | Action) {
  return { v: PROTOCOL_VERSION, id: crypto.randomUUID(), type, payload } as Parameters<
    typeof postNative
  >[0];
}

/**
 * Mac app: the native overlay cursor flies to workspace elements too. The page keeps reporting the
 * element's window rectangle (TargetRect, keyed by the action id) while the sentence is spoken, and
 * hands the action to the native sentence scheduler with a target that resolves to that rectangle.
 * Returns false when there is no native bridge or the target is not on this page.
 */
export async function pointNatively(action: Action, root: Document = document): Promise<boolean> {
  if (!hasNativeBridge()) return false;
  if (action.kind === "type" || action.kind === "clear" || action.kind === "openResource")
    return false;
  const element = workspaceElement(action.target, root);
  if (!element) return false;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  const report = (): void => {
    if (!element.isConnected) return;
    void postNative(envelope("TargetRect", measureFieldTarget(action.id, element))).catch(
      () => undefined,
    );
  };
  report();
  clearInterval(tracked.get(action.id));
  const started = Date.now();
  tracked.set(
    action.id,
    setInterval(() => {
      if (Date.now() - started > NATIVE_POINTER_CONFIG.trackMs) {
        clearInterval(tracked.get(action.id));
        tracked.delete(action.id);
        return;
      }
      report();
    }, NATIVE_POINTER_CONFIG.refreshMs),
  );
  await postNative(
    envelope("Action", { ...action, target: { kind: "ui", elementId: action.id } } as Action),
  );
  return true;
}
