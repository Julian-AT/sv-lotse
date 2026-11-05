import { createDatabase } from "@lotse/brain/db";
import { createObjectStorage } from "@lotse/brain/storage/s3";
import { expect, test } from "vitest";
import { loadLocalEnvironment } from "../scripts/load-env.mjs";
import { checkHealth } from "../src/server/health.ts";

loadLocalEnvironment();

test("AC1 health checks real Postgres and MinIO without a session", async () => {
  const database = createDatabase();
  const storage = createObjectStorage();
  try {
    const response = await checkHealth(database, storage);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      dependencies: { database: "up", objectStorage: "up" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  } finally {
    await database.close();
    storage.close();
  }
});

test("AC1 health reports 503 when a real database connection is unavailable", async () => {
  // An unreachable local port exercises the actual driver failure, not a test double.
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.hostname = "127.0.0.1";
  url.port = "1";
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  const storage = createObjectStorage();
  try {
    const response = await checkHealth(database, storage);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      dependencies: { database: "down", objectStorage: "up" },
    });
  } finally {
    await database.close();
    storage.close();
  }
});
