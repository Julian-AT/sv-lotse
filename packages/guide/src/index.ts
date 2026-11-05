import { type Action, type ActionResult, ActionSchema } from "@lotse/protocol";
import { createOverlay } from "./overlay/index.ts";
import {
  type DenyList,
  defaultDenyList,
  GuideConfigurationSchema,
  isDeniedControl,
} from "./safety.ts";
import {
  accessibleName,
  createSnapshotter,
  isVisible,
  type PageSnapshot,
  roleOf,
} from "./snapshot/index.ts";
import { resolveTarget } from "./targets.ts";
import { textField, typeVisible } from "./typing.ts";

export type { DenyList } from "./safety.ts";
export { DenyListSchema, defaultDenyList } from "./safety.ts";
export type { CapsulePage, PageHandle, PageSnapshot } from "./snapshot/index.ts";
export { toCapsulePage } from "./snapshot/index.ts";

export interface GuideOptions {
  allowlist: readonly string[];
  /** Additional rules; built-in safety rules always apply. */
  denyList?: DenyList;
  document?: Document;
  /** L1: show approved values beside fields without focus or input events. */
  ghostPreview?: boolean;
}

export interface Guide {
  snapshot(): PageSnapshot;
  execute(action: Action): Promise<ActionResult>;
  clear(): void;
  dispose(): void;
}

const actionableRoles = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

export function createGuide(options: GuideOptions): Guide {
  const configuration = GuideConfigurationSchema.parse({
    allowlist: options.allowlist,
    denyList: options.denyList ?? defaultDenyList,
    ghostPreview: options.ghostPreview ?? false,
  });
  const document = options.document ?? globalThis.document;
  const view = document?.defaultView;
  if (!view) throw new Error("A live browser document is required");
  const overlay = createOverlay(document);
  const snapshotter = createSnapshotter(document, overlay.contains, configuration.denyList);
  let disposed = false;
  let active: AbortController | undefined;
  const originAllowed = () => configuration.allowlist.includes(document.location.origin);
  const result = (actionId: string, failureReason?: string): ActionResult => ({
    actionId,
    resolvedBy: "dom",
    confidence: failureReason ? 0 : 1,
    success: !failureReason,
    ...(failureReason ? { failureReason } : {}),
  });
  function denied(element: Element): boolean {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const control = {
        role: roleOf(node),
        inputType:
          node.localName === "button"
            ? (node as HTMLButtonElement).type
            : node.localName === "input"
              ? (node as HTMLInputElement).type
              : "",
        label: accessibleName(node),
        autocomplete: node.getAttribute("autocomplete"),
      };
      // Non-controls (e.g. a form containing a submit button) must not inherit
      // their descendants' labels. Controls nested in denied controls do.
      if (
        (node.matches("input,button,a[href],select,textarea,summary,[contenteditable='true']") ||
          (node === element && node.hasAttribute("role")) ||
          actionableRoles.has(control.role) ||
          defaultDenyList.roles.includes(control.role) ||
          configuration.denyList.roles.includes(control.role)) &&
        (isDeniedControl(control, defaultDenyList) ||
          isDeniedControl(control, configuration.denyList))
      )
        return true;
    }
    return false;
  }
  function clear() {
    active?.abort();
    overlay.clear();
  }

  return {
    snapshot() {
      if (disposed) throw new Error("disposed");
      if (!originAllowed()) throw new Error("origin-not-allowed");
      return snapshotter.capture();
    },
    async execute(input) {
      const parsed = ActionSchema.safeParse(input);
      if (!parsed.success)
        return result(
          typeof input?.id === "string" && input.id ? input.id : "invalid-action",
          "invalid-action",
        );
      const action = parsed.data;
      if (disposed) return result(action.id, "disposed");
      if (!originAllowed()) return result(action.id, "origin-not-allowed");
      if (active) return result(action.id, "busy");
      if (action.kind === "openResource") return result(action.id, "unsupported-action");
      const controller = new AbortController();
      active = controller;
      try {
        // Always refresh: handles stay stable, but nodes, labels and geometry
        // can have changed since the capsule was captured.
        snapshotter.capture();
        const target = resolveTarget(
          document,
          action.target,
          snapshotter.element,
          overlay.contains,
        );
        const rect = target?.rects[0];
        if (!target || !rect) return result(action.id, "target-not-found");
        const guard = () => {
          if (disposed || controller.signal.aborted) return "interrupted";
          if (!originAllowed()) return "origin-not-allowed";
          if (
            action.target.kind === "dom" &&
            (action.target.url !== document.location.href ||
              snapshotter.element(action.target.handle) !== target.element)
          )
            return "target-not-found";
          if (!target.element.isConnected || !isVisible(target.element)) return "target-not-found";
          if (denied(target.element)) return "denied";
          return;
        };
        const failure = guard();
        if (failure) return result(action.id, failure);
        switch (action.kind) {
          case "point": {
            await overlay.point(rect);
            const afterPointing = guard();
            if (afterPointing) return result(action.id, afterPointing);
            if (action.payload.label) overlay.annotation(rect, action.payload.label);
            break;
          }
          case "highlight":
            overlay.highlight(target.rects);
            break;
          case "annotate":
            overlay.annotation(rect, action.payload.label ?? "");
            break;
          case "caption":
            overlay.caption(action.payload.label ?? "");
            break;
          case "type":
          case "clear": {
            if (action.target.kind !== "dom") return result(action.id, "unsupported-target");
            const field = textField(target.element);
            if (!field) return result(action.id, "unsupported-field");
            const value = action.kind === "type" ? action.payload.value : "";
            if (configuration.ghostPreview) {
              overlay.annotation(rect, value, true);
              break;
            }
            await overlay.point(rect);
            const beforeTyping = guard();
            if (beforeTyping) return result(action.id, beforeTyping);
            const failure = await typeVisible(
              field,
              value,
              action.kind === "type" ? action.payload.pace : 1,
              guard,
              controller.signal,
            );
            if (failure) return result(action.id, failure);
            // A new task lets the entire input/blur/change microtask checkpoint
            // finish, including microtasks queued by other microtasks.
            await new Promise<void>((resolve) => view.setTimeout(resolve, 0));
            const afterTyping = guard() ?? (field.value !== value ? "value-changed" : undefined);
            if (afterTyping) return result(action.id, afterTyping);
          }
        }
        return result(action.id, guard());
      } catch {
        return result(action.id, controller.signal.aborted ? "interrupted" : "execution-failed");
      } finally {
        if (active === controller) active = undefined;
      }
    },
    clear,
    dispose() {
      clear();
      disposed = true;
    },
  };
}
