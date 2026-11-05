import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema/index.ts";

export const databaseEnvironment = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
});

const CONNECT_TIMEOUT_SECONDS = 10;
const IDLE_TIMEOUT_SECONDS = 20;
const CLOSE_TIMEOUT_SECONDS = 5;

export function createDatabase(environment: NodeJS.ProcessEnv = process.env) {
  const config = databaseEnvironment.parse(environment);
  // No `ssl` option, so sslmode in the URL stays authoritative (Neon requires TLS).
  const client = postgres(config.DATABASE_URL, {
    max: config.DATABASE_POOL_SIZE,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    // Server notices can include SQL or user-supplied values.
    onnotice: () => {},
  });
  return {
    db: drizzle(client, { schema }),
    sql: client,
    config,
    close: () => client.end({ timeout: CLOSE_TIMEOUT_SECONDS }),
  };
}

export type Database = ReturnType<typeof createDatabase>;
export type DatabaseClient = Database["db"];
