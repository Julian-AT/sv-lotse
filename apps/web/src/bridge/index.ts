import {
  type BridgeHello,
  type BridgeToNative,
  BridgeToNativeSchema,
  type BridgeToWorkspace,
  BridgeToWorkspaceSchema,
} from "@lotse/protocol";

type Receiver = (message: BridgeToWorkspace) => void | Promise<void>;
type NativeHandler = { postMessage: (message: BridgeToNative) => unknown };
declare global {
  interface Window {
    webkit?: { messageHandlers?: { lotse?: NativeHandler } };
    __lotse?: { receive: (message: unknown) => unknown };
  }
}

/** The native host waits for this receiver before sending BridgeHello. No DOM-message channel. */
export function installBridge(receiver: Receiver): () => void {
  const previous = window.__lotse;
  const endpoint = {
    async receive(raw: unknown): Promise<void> {
      await receiver(BridgeToWorkspaceSchema.parse(raw));
    },
  };
  window.__lotse = endpoint;
  return () => {
    if (window.__lotse === endpoint) {
      if (previous) window.__lotse = previous;
      else delete window.__lotse;
    }
  };
}

export function hasNativeBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.webkit?.messageHandlers?.lotse);
}

export async function postNative(message: BridgeToNative): Promise<void> {
  const handler = window.webkit?.messageHandlers?.lotse;
  if (!handler) throw new Error("NATIVE_UNAVAILABLE");
  await handler.postMessage(BridgeToNativeSchema.parse(message));
}

export type BridgeSession = { hello?: BridgeHello };

let subscriber: Receiver | undefined;
let hello: Extract<BridgeToWorkspace, { type: "BridgeHello" }> | undefined;
let queued: BridgeToWorkspace[] = [];

/** Keep the native handshake available while cases/history are loading. */
export function mountWorkspaceBridge(): () => void {
  const uninstall = installBridge(async (message) => {
    if (message.type === "BridgeHello") hello = message;
    if (subscriber) await subscriber(message);
    else if (message.type !== "BridgeHello") queued.push(message);
  });
  return () => {
    uninstall();
    hello = undefined;
    queued = [];
    subscriber = undefined;
  };
}

export function subscribeBridge(receiver: Receiver): () => void {
  subscriber = receiver;
  const backlog = [...(hello ? [hello] : []), ...queued];
  queued = [];
  // Sequential replay preserves hello-before-transcript ordering.
  void (async () => {
    for (const message of backlog) {
      if (subscriber === receiver) await receiver(message);
    }
  })();
  return () => {
    if (subscriber === receiver) subscriber = undefined;
  };
}
