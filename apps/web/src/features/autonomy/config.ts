import { z } from "zod";

export const AUTONOMY_SETTINGS_URL = "/api/settings/autonomy";
export const AUTONOMY_CHANGED_EVENT = "lotse-autonomy-changed";
export const levelSchema = z.enum(["L1", "L2", "L3"]);
export type Level = z.infer<typeof levelSchema>;
export const settingSchema = z.strictObject({ autonomyLevel: levelSchema });
export const fillPagesSchema = z.object({
  allowedFillPages: z.array(z.url({ protocol: /^https$/ })),
});
