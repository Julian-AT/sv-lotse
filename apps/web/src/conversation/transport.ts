import {
  type ActionResult,
  type BridgeHello,
  type ContextCapsule,
  PROTOCOL_VERSION,
  TurnRequestSchema,
} from "@lotse/protocol";
import { DefaultChatTransport, type UIMessage } from "ai";
import { WORKSPACE_CONFIG } from "./config.ts";

export type TurnState = {
  caseId?: string;
  inputKind: "text" | "transcript";
  language: string;
  capsule: ContextCapsule;
  actionResults: ActionResult[];
  hello?: BridgeHello;
};

/** Server owns history. Even approval/output continuations send only the latest SDK message. */
export function latestTurnBody(messages: UIMessage[], state: TurnState): Record<string, unknown> {
  return {
    ...TurnRequestSchema.parse({
      caseId: state.caseId,
      inputKind: state.inputKind,
      language: state.language,
      capsule: state.capsule,
      actionResults: state.actionResults,
    }),
    clientHello: {
      clientKind: state.hello ? "mac" : "web",
      appVersion: WORKSPACE_CONFIG.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: state.hello?.capabilities ?? {
        overlay: false,
        accessibility: false,
        ocr: false,
        onDeviceModel: false,
        onDeviceContextSize: 0,
      },
      locale: state.language,
    },
    message: messages.at(-1),
  };
}

export function createTurnTransport<Message extends UIMessage>(
  state: TurnState,
  onCase: (caseId: string) => void,
): DefaultChatTransport<Message> {
  return new DefaultChatTransport<Message>({
    api: WORKSPACE_CONFIG.turnApi,
    credentials: "same-origin",
    prepareSendMessagesRequest: ({ messages }) => ({ body: latestTurnBody(messages, state) }),
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const caseId = response.headers.get("x-lotse-case-id");
      if (response.ok && caseId) {
        state.caseId = caseId;
        state.actionResults = [];
        onCase(caseId);
      }
      return response;
    },
  });
}
