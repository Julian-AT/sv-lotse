import type { DatabaseClient } from "@lotse/db";
import { profiles, users } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readBookingPages } from "./booking.ts";
import { AutonomyError, type AutonomyLevel, autonomyChangeSchema } from "./schema.ts";

export { type BookingGuideConfiguration, bookingGuideConfiguration } from "./guide.ts";
export {
  AutonomyError,
  type AutonomyLevel,
  autonomyChangeSchema,
  autonomyLevelSchema,
} from "./schema.ts";

export interface AutonomyService {
  read(): Promise<{ autonomyLevel: AutonomyLevel }>;
  change(input: unknown): Promise<{ autonomyLevel: AutonomyLevel }>;
}

/** The settings panel projects the same reviewed pages used by ui.fill authorization. */
export async function autonomyFillPages(db: DatabaseClient, userId: string): Promise<string[]> {
  const { autonomyLevel } = await createAutonomyService(db, userId).read();
  return autonomyLevel === "L3" ? readBookingPages(db) : [];
}

/** Bound only to requireSession's identity. A helper cannot select the subject's profile. */
export function createAutonomyService(db: DatabaseClient, userId: string): AutonomyService {
  if (!z.uuid().safeParse(userId).success) throw new AutonomyError("AUTONOMY_ACCESS_DENIED");
  return {
    async read() {
      const [record] = await db
        .select({ autonomyLevel: profiles.autonomyLevel })
        .from(users)
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .where(eq(users.id, userId));
      if (!record) throw new AutonomyError("AUTONOMY_ACCESS_DENIED");
      return { autonomyLevel: record.autonomyLevel ?? "L1" };
    },
    async change(input) {
      const parsed = autonomyChangeSchema.safeParse(input);
      if (!parsed.success) throw new AutonomyError("INVALID_AUTONOMY");
      return db.transaction(async (tx) => {
        // Serialize settings writes with self-subject creation and concurrent changes.
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        if (!user) throw new AutonomyError("AUTONOMY_ACCESS_DENIED");
        const [profile] = await tx
          .insert(profiles)
          .values({ userId, autonomyLevel: parsed.data.autonomyLevel })
          .onConflictDoUpdate({
            target: profiles.userId,
            set: { autonomyLevel: parsed.data.autonomyLevel },
          })
          .returning({ autonomyLevel: profiles.autonomyLevel });
        if (!profile) throw new AutonomyError("AUTONOMY_ACCESS_DENIED");
        return profile;
      });
    },
  };
}
