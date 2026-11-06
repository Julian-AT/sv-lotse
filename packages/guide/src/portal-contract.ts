import { ContextCapsuleSchema } from "@lotse/protocol";
import { z } from "zod";
import { PORTAL_CONFIG } from "./config.ts";

const origin = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
});
export const PortalConnectionSchema = z.strictObject({
  workspaceOrigin: origin,
  portalOrigin: origin,
  channel: z.uuid(),
  allowlist: z.array(origin),
});
export type PortalConnection = z.infer<typeof PortalConnectionSchema>;
export const PortalFieldSchema = z.strictObject({
  handle: z.string().min(1),
  label: z.string(),
  value: z.string().max(PORTAL_CONFIG.maxValueLength),
});
export type PortalField = z.infer<typeof PortalFieldSchema>;
const envelope = { channel: z.uuid(), id: z.uuid() };
export const PortalCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...envelope, kind: z.literal("snapshot") }),
  z.strictObject({
    ...envelope,
    kind: z.literal("point"),
    url: z.url(),
    handle: z.string().min(1),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal("fill"),
    url: z.url(),
    approved: z.literal(true),
    fields: z.array(PortalFieldSchema).min(1).max(PORTAL_CONFIG.maxFields),
  }),
  z.strictObject({ ...envelope, kind: z.literal("clear") }),
  z.strictObject({ ...envelope, kind: z.literal("disconnect") }),
]);
export type PortalCommand = z.infer<typeof PortalCommandSchema>;
export type PortalRequest = {
  [Kind in PortalCommand["kind"]]: Omit<Extract<PortalCommand, { kind: Kind }>, "channel" | "id">;
}[PortalCommand["kind"]];
export const PortalPageSchema = ContextCapsuleSchema.shape.page.unwrap().extend({
  handles: ContextCapsuleSchema.shape.page.unwrap().shape.handles.max(PORTAL_CONFIG.maxHandles),
});
export type PortalPage = z.infer<typeof PortalPageSchema>;
export const PortalReplySchema = z.strictObject({
  channel: z.uuid(),
  id: z.uuid(),
  kind: z.enum(["ready", "snapshot", "result", "closed"]),
  success: z.boolean(),
  page: PortalPageSchema.optional(),
});
export type PortalReply = z.infer<typeof PortalReplySchema>;

export function allowedPortalUrl(value: string, allowlist: readonly string[]): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowlist.includes(url.origin)
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
