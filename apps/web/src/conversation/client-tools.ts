import { createGuide, type Guide, toCapsulePage } from "@lotse/guide";
import {
  type Action,
  type ActionResult,
  type BridgeToNative,
  JsonObjectSchema,
  PROTOCOL_VERSION,
  ProvenanceSchema,
  TargetSchema,
  ToolInvocationSchema,
} from "@lotse/protocol";
import { z } from "zod";
import { hasNativeBridge, postNative } from "../bridge/index.ts";
import { dispatchFormAction, formViewerMounted } from "../features/form-viewer/workspace.tsx";
import { WORKSPACE_CONFIG } from "./config.ts";
import { formFieldUiTarget, openResource } from "./open-resource.ts";

export function nativeEnvelope<Message extends BridgeToNative["type"]>(
  type: Message,
  payload: Extract<BridgeToNative, { type: Message }>["payload"],
): BridgeToNative {
  // Parse at the actual boundary in postNative; this also narrows the discriminated union here.
  return { v: PROTOCOL_VERSION, id: crypto.randomUUID(), type, payload } as BridgeToNative;
}

const fillSchema = z.strictObject({
  target: TargetSchema,
  value: z.string(),
  provenance: ProvenanceSchema,
});

export type ClientToolResult = { output: unknown } | { errorText: string } | { native: true };
export type ClientRuntime = {
  execute: (toolCallId: string, toolName: string, input: unknown) => Promise<ClientToolResult>;
  action: (action: Action) => Promise<ActionResult | undefined>;
  clear: () => void;
  dispose: () => void;
};

/** Only the workspace page is allowed. External portals have their own guide runtime. */
export function createClientRuntime(
  options: { openDocumentHighlight?: ((action: Action) => void) | undefined } = {},
): ClientRuntime {
  let guide: Guide | undefined;
  const pageGuide = (): Guide => {
    guide ??= createGuide({ allowlist: [window.location.origin] });
    return guide;
  };
  return {
    async execute(toolCallId, toolName, input) {
      if (toolName === "ui.openResource")
        return {
          output: await openResource(toolCallId, input, {
            formMounted: formViewerMounted,
            openDocument: options.openDocumentHighlight,
          }),
        };
      if (toolName === "context.readPage")
        return { output: { page: toCapsulePage(pageGuide().snapshot()) } };
      if (toolName === "ui.fill") {
        const fill = fillSchema.parse(input);
        const action: Action = {
          id: toolCallId,
          kind: "type",
          sentenceIndex: 0,
          target: fill.target,
          payload: {
            value: fill.value,
            provenance: fill.provenance,
            pace: WORKSPACE_CONFIG.typingPaceMs,
          },
        };
        if (fill.target.kind === "form") return { output: await dispatchFormAction(action) };
        if (fill.target.kind !== "ax") return { output: await pageGuide().execute(action) };
      }
      if (hasNativeBridge()) {
        const invocation = ToolInvocationSchema.safeParse({
          toolCallId,
          toolName,
          input: JsonObjectSchema.parse(input),
        });
        if (!invocation.success) return { errorText: "CLIENT_TOOL_UNAVAILABLE" };
        await postNative(nativeEnvelope("ToolInvocation", invocation.data));
        return { native: true };
      }
      return { errorText: "CLIENT_TOOL_REQUIRES_MAC" };
    },
    async action(action) {
      if (action.kind === "type" && action.target.kind === "form")
        return dispatchFormAction(action);
      if (
        action.kind === "highlight" &&
        action.target.kind === "text" &&
        action.target.documentId
      ) {
        if (options.openDocumentHighlight) {
          options.openDocumentHighlight(action);
          return;
        }
        return {
          actionId: action.id,
          resolvedBy: "ui",
          confidence: 0,
          success: false,
          failureReason: "DOCUMENT_VIEWER_UNAVAILABLE",
        };
      }
      if (action.target.kind === "ax") {
        if (hasNativeBridge()) {
          await postNative(nativeEnvelope("Action", action));
          return;
        }
        return {
          actionId: action.id,
          resolvedBy: "ax",
          confidence: 0,
          success: false,
          failureReason: "CLIENT_TOOL_REQUIRES_MAC",
        };
      }
      // Mutations enter exclusively through the server-verified ui.fill continuation.
      if (action.kind === "type" || action.kind === "clear")
        return {
          actionId: action.id,
          resolvedBy: "ui",
          confidence: 0,
          success: false,
          failureReason: "APPROVAL_REQUIRED",
        };
      const formField = formFieldUiTarget(action.target);
      if (formField) return pageGuide().execute({ ...action, target: formField } as Action);
      return pageGuide().execute(action);
    },
    clear: () => guide?.clear(),
    dispose: () => guide?.dispose(),
  };
}
