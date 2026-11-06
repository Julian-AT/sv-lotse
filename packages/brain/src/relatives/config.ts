import { z } from "zod";

export const RELATIVE_INVITE_LIFETIME_MS = 15 * 60 * 1000;
export const RELATIVE_SESSION_LIFETIME_MS = 60 * 60 * 1000;
export const RELATIVE_TOKEN_TTL_SECONDS = 15;

export const RELATIVES_TOKEN_TTL_SECONDS = 15 * 60;
export const RELATIVES_ROOM_PREFIX = "lotse-relatives-";
export const RELATIVES_POINTER_TOPIC = "lotse.relatives.pointer.v1";

const optionalKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const serverUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "wss:" ||
      (url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
});

export const relativesEnvironmentShape = {
  LIVEKIT_URL: z.preprocess((value) => (value === "" ? undefined : value), serverUrl.optional()),
  LIVEKIT_API_KEY: optionalKey,
  LIVEKIT_API_SECRET: optionalKey,
};

export const relativesConfigurationSchema = z.object({
  LIVEKIT_URL: serverUrl,
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});
export type RelativesConfiguration = z.infer<typeof relativesConfigurationSchema>;
