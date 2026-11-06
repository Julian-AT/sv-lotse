import {
  BridgeToNativeSchema,
  type BridgeToWorkspace,
  BridgeToWorkspaceSchema,
  PROTOCOL_VERSION,
  type TargetRect,
} from "@lotse/protocol";

type NativeWindow = Window & {
  __lotse?: { receive: (input: unknown) => unknown };
  webkit?: {
    messageHandlers?: { lotse?: { postMessage: (message: unknown) => Promise<unknown> } };
  };
};

const listeners = new Set<(message: BridgeToWorkspace) => void>();
let installedReceiver: NativeWindow["__lotse"];

/** A full workspace bridge can forward its validated incoming messages here. */
export function receiveFormViewerBridgeMessage(input: unknown): void {
  const parsed = BridgeToWorkspaceSchema.safeParse(input);
  if (parsed.success) for (const listener of listeners) listener(parsed.data);
}

/** Standalone viewer supplies the native handshake only when no workspace receiver exists. */
export function subscribeFormViewerBridge(
  listener: (message: BridgeToWorkspace) => void,
): () => void {
  const native = window as NativeWindow;
  const receiver = {
    receive: (input: unknown): { accepted: boolean } => {
      const parsed = BridgeToWorkspaceSchema.safeParse(input);
      if (!parsed.success) return { accepted: false };
      receiveFormViewerBridgeMessage(parsed.data);
      return { accepted: true };
    },
  };
  if (!native.__lotse) {
    native.__lotse = receiver;
    installedReceiver = receiver;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && native.__lotse === installedReceiver) {
      delete native.__lotse;
      installedReceiver = undefined;
    }
  };
}

/** The workspace can supply its shared bridge instead. Browser-only use is a no-op. */
export async function reportFormTargetRect(payload: TargetRect): Promise<void> {
  const message = BridgeToNativeSchema.parse({
    v: PROTOCOL_VERSION,
    type: "TargetRect",
    id: crypto.randomUUID(),
    payload,
  });
  await (window as NativeWindow).webkit?.messageHandlers?.lotse?.postMessage(message);
}

export function measureFieldTarget(targetId: string, element: HTMLElement): TargetRect {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  return {
    targetId,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    scale: view?.devicePixelRatio || 1,
    visible:
      element.isConnected &&
      rect.width > 0 &&
      rect.height > 0 &&
      isVisibleInScrollContainers(element, rect, view),
  };
}

function isVisibleInScrollContainers(
  element: HTMLElement,
  rect: DOMRect,
  view: Window | null,
): boolean {
  if (!view || view.getComputedStyle(element).visibility === "hidden") return false;
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(view.innerWidth, rect.right);
  let bottom = Math.min(view.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent);
    const clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  return left < right && top < bottom;
}
