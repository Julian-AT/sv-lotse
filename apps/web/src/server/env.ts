import { relativesEnvironmentShape } from "@lotse/brain/relatives";
import { z } from "zod";

const optionalKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = (fallback: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url({ protocol: /^https?$/ }).default(fallback),
  );
const environmentSchema = z
  .object({
    ...relativesEnvironmentShape,
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    SESSION_SECRET: z.string().min(32),
    CRON_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
    S3_PREFIX: z.string().default(""),
    LOTSE_WORKSPACE_URL: optionalUrl("http://localhost:3000"),
    LIVEKIT_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url({ protocol: /^wss?$/ }).default("ws://localhost:7880"),
    ),
    LIVEKIT_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).default("devkey"),
    ),
    LIVEKIT_API_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).default("secret"),
    ),
    SVBOX_DIR: z.string().min(1).default("data/svbox"),
    LANGFUSE_PUBLIC_KEY: optionalKey,
    LANGFUSE_SECRET_KEY: optionalKey,
    LANGFUSE_BASE_URL: optionalUrl("https://cloud.langfuse.com"),
    POSTHOG_KEY: optionalKey,
    POSTHOG_HOST: optionalUrl("https://eu.i.posthog.com"),
    OPENAI_API_KEY: optionalKey,
    ELEVENLABS_API_KEY: optionalKey,
    ELEVENLABS_VOICE_ID_DE: optionalKey,
    ELEVENLABS_VOICE_ID_EN: optionalKey,
  })
  .superRefine((config, context) => {
    const relatives = [config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET];
    if (relatives.some(Boolean) && !relatives.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET"],
        message: "Configure all LiveKit values",
      });
    }
    if (Boolean(config.LANGFUSE_PUBLIC_KEY) !== Boolean(config.LANGFUSE_SECRET_KEY)) {
      context.addIssue({
        code: "custom",
        path: [config.LANGFUSE_PUBLIC_KEY ? "LANGFUSE_SECRET_KEY" : "LANGFUSE_PUBLIC_KEY"],
        message: "Both Langfuse keys are required",
      });
    }
  });

export type ServerEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(environment: Record<string, unknown>): ServerEnvironment {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Missing or invalid server environment variables: ${names.join(", ")}`);
  }
  return result.data;
}

let environment: ServerEnvironment | undefined;
export function getEnvironment(): ServerEnvironment {
  environment ??= parseEnvironment(process.env);
  return environment;
}

export function resourceEnvironment(config: ServerEnvironment): NodeJS.ProcessEnv {
  return { ...config, DATABASE_POOL_SIZE: String(config.DATABASE_POOL_SIZE) };
}
