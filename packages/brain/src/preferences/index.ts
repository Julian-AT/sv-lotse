import type { DatabaseClient } from "@lotse/db";
import { caseActors, profiles, turns, users } from "@lotse/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { TURN_LEASE_MS } from "../config/index.ts";
import {
  type Preferences,
  preferencesPatchSchema,
  preferencesSchema,
  profilePreferences,
} from "./schema.ts";

export class PreferencesError extends Error {
  readonly code = "PREFERENCES_TURN_RUNNING";
  readonly status = 409;
  constructor() {
    super("Preferences cannot change autonomy during an active turn");
    this.name = "PreferencesError";
  }
}

/** The host supplies only its authenticated user id, never an id from request input. */
export function createPreferencesService(db: DatabaseClient, userId: string) {
  async function read(): Promise<Preferences> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    return profilePreferences(profile);
  }

  async function update(input: unknown): Promise<Preferences> {
    const patch = preferencesPatchSchema.parse(input);
    return db.transaction(async (tx) => {
      // Turn creation takes this same lock before reading the profile.
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!user) throw new Error("Preference owner missing");
      const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
      const current = profilePreferences(profile);
      const next = preferencesSchema.parse({ ...current, ...patch });
      if (next.autonomyLevel !== current.autonomyLevel) {
        const running = await tx
          .select({ id: turns.id })
          .from(turns)
          .innerJoin(caseActors, eq(caseActors.caseId, turns.caseId))
          .where(
            and(
              eq(caseActors.userId, userId),
              eq(caseActors.role, "subject"),
              eq(turns.status, "running"),
              gt(turns.createdAt, new Date(Date.now() - TURN_LEASE_MS)),
            ),
          )
          .limit(1);
        if (running.length > 0) throw new PreferencesError();
      }
      const { language, register, detailLevel, autonomyLevel, ...presentation } = next;
      const values = { language, register, detailLevel, autonomyLevel, preferences: presentation };
      await tx
        .insert(profiles)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: profiles.userId, set: values });
      return next;
    });
  }
  return { read, update };
}
