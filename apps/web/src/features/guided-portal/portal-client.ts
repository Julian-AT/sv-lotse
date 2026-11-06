import {
  PortalCommandSchema,
  type PortalConnection,
  type PortalReply,
  PortalReplySchema,
  type PortalRequest,
} from "@lotse/guide/portal";
import { GUIDED_PORTAL_CONFIG } from "./config.ts";

export interface PortalClient {
  send(command: PortalRequest): void;
  dispose(): void;
}

export function connectPortalWindow(
  popup: Window,
  connection: PortalConnection,
  onReply: (reply: PortalReply) => void,
  onTimeout: () => void,
): PortalClient {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let active = true;
  let ready = false;
  let readyId: string | undefined;
  let timer = setTimeout(fail, GUIDED_PORTAL_CONFIG.connectionTimeoutMs);
  function fail(): void {
    dispose();
    onTimeout();
  }
  function receive(event: MessageEvent<unknown>): void {
    if (
      !event.isTrusted ||
      !active ||
      event.source !== popup ||
      event.origin !== connection.portalOrigin
    )
      return;
    const parsed = PortalReplySchema.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== connection.channel) return;
    const reply = parsed.data;
    if (reply.kind === "closed") {
      if (reply.id !== readyId) return;
      ready = false;
      for (const timeout of pending.values()) clearTimeout(timeout);
      pending.clear();
      clearTimeout(timer);
      timer = setTimeout(fail, GUIDED_PORTAL_CONFIG.connectionTimeoutMs);
      onReply(reply);
      return;
    }
    if (reply.kind === "ready") {
      if (reply.id === readyId) return;
      readyId = reply.id;
      ready = true;
      for (const timeout of pending.values()) clearTimeout(timeout);
      pending.clear();
      clearTimeout(timer);
    } else {
      const timeout = pending.get(reply.id);
      if (!timeout) return;
      clearTimeout(timeout);
      pending.delete(reply.id);
    }
    if (reply.page && new URL(reply.page.url).origin !== connection.portalOrigin) {
      fail();
      return;
    }
    onReply(reply);
  }
  function dispose(): void {
    if (!active) return;
    popup.postMessage(
      { kind: "disconnect", channel: connection.channel, id: crypto.randomUUID() },
      connection.portalOrigin,
    );
    active = false;
    clearTimeout(timer);
    for (const timeout of pending.values()) clearTimeout(timeout);
    pending.clear();
    window.removeEventListener("message", receive);
    window.removeEventListener("pagehide", dispose);
  }
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", dispose);
  return {
    send(command) {
      if (!active || !ready || popup.closed) {
        fail();
        return;
      }
      const id = crypto.randomUUID();
      const parsed = PortalCommandSchema.safeParse({ ...command, id, channel: connection.channel });
      if (!parsed.success) {
        fail();
        return;
      }
      pending.set(id, setTimeout(fail, GUIDED_PORTAL_CONFIG.commandTimeoutMs));
      popup.postMessage(parsed.data, connection.portalOrigin);
    },
    dispose,
  };
}
