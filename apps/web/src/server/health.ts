import type { Database } from "@lotse/brain/db";
import type { createObjectStorage } from "@lotse/brain/storage/s3";
import { getDatabase, getStorage } from "./resources.ts";

// Bound the response even while a dependency is reconnecting. Late rejections stay handled.
async function dependencyStatus(operation: Promise<unknown>): Promise<"up" | "down"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Dependency check timed out")), 3000);
      }),
    ]);
    return "up";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(
  database: Database = getDatabase(),
  storage: ReturnType<typeof createObjectStorage> = getStorage(),
): Promise<Response> {
  const [databaseStatus, objectStorage] = await Promise.all([
    dependencyStatus(database.sql`select 1`),
    dependencyStatus(storage.headBucket()),
  ]);
  const healthy = databaseStatus === "up" && objectStorage === "up";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      dependencies: { database: databaseStatus, objectStorage },
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
