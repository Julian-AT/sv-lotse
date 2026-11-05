import { expect, test } from "vitest";
import { parseEnvironment } from "../src/server/env.ts";

// Non-secret unit fixtures; real services are exercised separately.
const required = {
  DATABASE_URL: "postgres://user:password@localhost/database",
  SESSION_SECRET: "unit-test-signing-key-32-characters-long",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "test",
  S3_ACCESS_KEY_ID: "unit-access",
  S3_SECRET_ACCESS_KEY: "unit-secret",
};

test("environment lists missing names without exposing configured values", () => {
  expect(() => parseEnvironment({ DATABASE_URL: "sensitive-invalid-value" })).toThrow(
    /DATABASE_URL.*SESSION_SECRET.*S3_ENDPOINT.*S3_BUCKET.*S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY/,
  );
  expect(() => parseEnvironment({ DATABASE_URL: "sensitive-invalid-value" })).not.toThrow(
    /sensitive-invalid-value/,
  );
});

test("optional environment defaults disable exports and analytics", () => {
  const config = parseEnvironment(required);
  expect(config.LOTSE_WORKSPACE_URL).toBe("http://localhost:3000");
  expect(config.SVBOX_DIR).toBe("data/svbox");
  expect(config.LANGFUSE_PUBLIC_KEY).toBeUndefined();
  expect(config.POSTHOG_KEY).toBeUndefined();
});

test("environment rejects partial Langfuse credentials and short session keys", () => {
  expect(() => parseEnvironment({ ...required, LANGFUSE_PUBLIC_KEY: "unit-public" })).toThrow(
    /LANGFUSE_SECRET_KEY/,
  );
  expect(() => parseEnvironment({ ...required, SESSION_SECRET: "short" })).toThrow(
    /SESSION_SECRET/,
  );
});

test("empty optional provider keys and URLs use disabled defaults", () => {
  const config = parseEnvironment({
    ...required,
    LANGFUSE_PUBLIC_KEY: "",
    LANGFUSE_SECRET_KEY: "",
    LANGFUSE_BASE_URL: "",
    POSTHOG_KEY: "",
    POSTHOG_HOST: "",
  });
  expect(config.LANGFUSE_PUBLIC_KEY).toBeUndefined();
  expect(config.LANGFUSE_SECRET_KEY).toBeUndefined();
  expect(config.LANGFUSE_BASE_URL).toBe("https://cloud.langfuse.com");
  expect(config.POSTHOG_KEY).toBeUndefined();
});
