import { timestamp, uuid } from "drizzle-orm/pg-core";
import type { z } from "zod";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export type JsonRecord = Record<string, JsonValue>;

export const id = () => uuid("id").defaultRandom().primaryKey();
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const time = (name: string) => timestamp(name, { withTimezone: true });
