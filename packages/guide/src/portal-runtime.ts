import { PORTAL_CONFIG } from "./config.ts";
import { createGuide, type Guide, toCapsulePage } from "./index.ts";
import {
  type PortalCommand,
  PortalCommandSchema,
  PortalConnectionSchema,
  type PortalField,
  type PortalReply,
} from "./portal-contract.ts";
import { defaultDenyList, isDeniedControl } from "./safety.ts";

async function fillGroup(
  guide: Guide,
  command: Extract<PortalCommand, { kind: "fill" }>,
  cancelled: () => boolean,
): Promise<boolean> {
  const snapshot = guide.snapshot();
  // Validate the whole reviewed group before the first side effect.
  if (
    snapshot.url !== command.url ||
    new Set(command.fields.map((field) => field.handle)).size !== command.fields.length
  )
    return false;
  const matches = (field: PortalField) =>
    guide
      .snapshot()
      .handles.some(
        (handle) =>
          handle.handle === field.handle &&
          handle.label === field.label &&
          handle.visible &&
          !handle.credential &&
          ["textbox", "searchbox"].includes(handle.role) &&
          !isDeniedControl(
            { role: handle.role, label: handle.label, inputType: "" },
            defaultDenyList,
          ),
      );
  if (!command.fields.every(matches)) return false;
  for (const field of command.fields) {
    if (cancelled() || !matches(field)) return false;
    const result = await guide.execute({
      id: crypto.randomUUID(),
      kind: "type",
      sentenceIndex: 0,
      target: { kind: "dom", url: command.url, handle: field.handle },
      payload: {
        value: field.value,
        pace: PORTAL_CONFIG.paceMs,
        provenance: { source: { kind: "statement", quote: field.value } },
      },
    });
    if (!result.success) return false;
  }
  return !cancelled();
}

/** A guide-only channel; never exposes workspace, native, or conversation capabilities. */
export function connectPortal(input: unknown, onDispose?: () => void): () => void {
  const connection = PortalConnectionSchema.parse(input);
  const peer: Window | null = window.opener;
  if (
    !peer ||
    location.origin !== connection.portalOrigin ||
    !connection.allowlist.includes(location.origin)
  )
    throw new Error("portal-connection-refused");
  const guide = createGuide({ allowlist: connection.allowlist });
  const connectionId = crypto.randomUUID();
  let generation = 0;
  let filling = false;
  let closed = false;
  const seen = new Set<string>();
  function reply(message: Omit<PortalReply, "channel">): void {
    peer?.postMessage({ ...message, channel: connection.channel }, connection.workspaceOrigin);
  }
  function dispose(): void {
    if (closed) return;
    closed = true;
    generation++;
    guide.dispose();
    window.removeEventListener("message", receive);
    window.removeEventListener("pagehide", dispose);
    reply({ id: connectionId, kind: "closed", success: true });
    onDispose?.();
  }
  async function run(command: PortalCommand): Promise<void> {
    if (command.kind === "disconnect") {
      dispose();
      return;
    }
    if (command.kind === "clear") {
      generation++;
      guide.clear();
    } else if (command.kind === "snapshot") {
      reply({
        id: command.id,
        kind: "snapshot",
        success: true,
        page: toCapsulePage(guide.snapshot()),
      });
      return;
    } else if (filling) {
      reply({ id: command.id, kind: "result", success: false });
      return;
    } else if (command.kind === "point") {
      const result = await guide.execute({
        id: command.id,
        kind: "point",
        sentenceIndex: 0,
        target: { kind: "dom", handle: command.handle, url: command.url },
        payload: {},
      });
      reply({ id: command.id, kind: "result", success: result.success });
      return;
    } else {
      const current = generation;
      filling = true;
      try {
        const success = await fillGroup(guide, command, () => closed || generation !== current);
        reply({ id: command.id, kind: "result", success });
      } finally {
        filling = false;
      }
      return;
    }
    reply({ id: command.id, kind: "result", success: true });
  }
  function receive(event: MessageEvent<unknown>): void {
    if (
      !event.isTrusted ||
      closed ||
      event.source !== peer ||
      event.origin !== connection.workspaceOrigin
    )
      return;
    const parsed = PortalCommandSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== connection.channel || seen.has(parsed.data.id))
      return;
    seen.add(parsed.data.id);
    void run(parsed.data).catch(() =>
      reply({ id: parsed.data.id, kind: "result", success: false }),
    );
  }
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", dispose);
  reply({ id: connectionId, kind: "ready", success: true });
  return dispose;
}
