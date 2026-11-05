import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema/index.ts";

export const databaseEnvironment = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
});

export function createDatabase(environment: NodeJS.ProcessEnv = process.env) {
  const config = databaseEnvironment.parse(environment);
  const client = postgres(config.DATABASE_URL, {
    max: config.DATABASE_POOL_SIZE,
    connect_timeout: 10,
    idle_timeout: 20,
    // Keep sslmode from the URL intact (Neon requires TLS).
    // Suppress server notices: they can include SQL or user-supplied values.
    onnotice: () => {},
  });
  return {
    db: drizzle(client, { schema }),
    sql: client,
    config,
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDatabase>;
export type DatabaseClient = Database["db"];
