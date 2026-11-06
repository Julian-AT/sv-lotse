import type { LotseMessage } from "@lotse/brain";

/** The template's message type is our brain's UI message. */
export type ChatMessage = LotseMessage;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};

export type WaitingStatusData = { message: string };
