import type { DatabaseClient } from "@lotse/db";
import { z } from "zod";
import { resolveContext, type SessionIdentity } from "../conversation/store.ts";
import { readBookingConfiguration } from "./booking.ts";
import { AutonomyError, type AutonomyLevel } from "./schema.ts";

export interface BookingGuideConfiguration {
  autonomyLevel: AutonomyLevel;
  allowlist: string[];
  bookingPages: string[];
  ghostPreview: boolean;
}

/** Authenticate the case before disclosing or enabling its guide capabilities. */
export async function bookingGuideConfiguration(
  db: DatabaseClient,
  caseId: string,
  session: SessionIdentity,
): Promise<BookingGuideConfiguration> {
  if (!z.uuid().safeParse(caseId).success) throw new AutonomyError("INVALID_AUTONOMY");
  return db.transaction(async (tx) => {
    const context = await resolveContext(
      tx,
      { caseId, inputKind: "text", capsule: {}, actionResults: [] },
      session,
    );
    const configuration = await readBookingConfiguration(tx);
    return {
      ...configuration,
      autonomyLevel: context.autonomyLevel,
      bookingPages:
        context.actorRole === "subject" && context.autonomyLevel === "L3"
          ? configuration.bookingPages
          : [],
      ghostPreview: context.actorRole === "helper" || context.autonomyLevel === "L1",
    };
  });
}
