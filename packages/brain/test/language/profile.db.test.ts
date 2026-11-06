import { randomUUID } from "node:crypto";
import { caseActors, profiles } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveContext } from "../../src/conversation/store.ts";
import {
  DEFAULT_PROFILE_SETTINGS,
  readProfileSettings,
  updateProfileSettings,
} from "../../src/language/settings.ts";
import { identity, isolatedDatabase, turn } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  if (database) await database.cleanup();
});

it("FR-L3 persists settings on the caller and applies them on the next turn", async () => {
  const caller = await identity(database.db, "L2");
  const another = await identity(database.db);
  const settings = {
    language: "en" as const,
    simpleLanguage: true,
    register: "informal" as const,
    detailLevel: "brief" as const,
  };
  expect(await updateProfileSettings(database.db, caller.userId, settings)).toEqual(settings);
  expect(await readProfileSettings(database.db, caller.userId)).toEqual(settings);
  expect(await readProfileSettings(database.db, another.userId)).toEqual(DEFAULT_PROFILE_SETTINGS);
  const context = await database.db.transaction((tx) => resolveContext(tx, turn, caller));
  expect(context.profileSettings).toEqual(settings);
  expect(context.autonomyLevel).toBe("L2");
  await updateProfileSettings(database.db, caller.userId, { simpleLanguage: false });
  expect(await readProfileSettings(database.db, caller.userId)).toEqual({
    ...settings,
    simpleLanguage: false,
  });
});

it("FR-L3 safely creates a missing profile and merges concurrent partial updates", async () => {
  const caller = await identity(database.db);
  await database.db.delete(profiles).where(eq(profiles.userId, caller.userId));
  await Promise.all([
    updateProfileSettings(database.db, caller.userId, { language: "en" }),
    updateProfileSettings(database.db, caller.userId, { register: "informal" }),
  ]);
  expect(await readProfileSettings(database.db, caller.userId)).toMatchObject({
    language: "en",
    register: "informal",
  });
  await expect(
    updateProfileSettings(database.db, caller.userId, {
      userId: randomUUID(),
      autonomyLevel: "L3",
    }),
  ).rejects.toThrow();
});

it("FR-L3 uses a helper's communication preferences without changing the owner's autonomy", async () => {
  const owner = await identity(database.db, "L2");
  const helper = await identity(database.db, "L3");
  const ownerContext = await database.db.transaction((tx) => resolveContext(tx, turn, owner));
  await database.db.insert(caseActors).values({
    caseId: ownerContext.caseId,
    userId: helper.userId,
    role: "helper",
    shareScope: { case: true, facts: true },
  });
  await updateProfileSettings(database.db, helper.userId, {
    language: "en",
    register: "informal",
    simpleLanguage: true,
  });
  const context = await database.db.transaction((tx) =>
    resolveContext(tx, { ...turn, caseId: ownerContext.caseId }, helper),
  );
  expect(context.profileSettings).toMatchObject({
    language: "en",
    register: "informal",
    simpleLanguage: true,
  });
  expect(context.autonomyLevel).toBe("L2");
  expect(await readProfileSettings(database.db, owner.userId)).toEqual(DEFAULT_PROFILE_SETTINGS);
});
