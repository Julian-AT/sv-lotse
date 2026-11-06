import type { LotseMessage } from "@lotse/brain";
import { DATA_PARTS } from "@lotse/protocol";
import { validateUIMessages } from "ai";
import { z } from "zod";

const historySchema = z.strictObject({ messages: z.array(z.unknown()) });

export async function parseHistory(raw: unknown): Promise<LotseMessage[]> {
  const { messages } = historySchema.parse(raw);
  // SDK validation requires a nonempty list; a new persisted case has no messages yet.
  return messages.length === 0
    ? []
    : validateUIMessages<LotseMessage>({ messages, dataSchemas: DATA_PARTS });
}
