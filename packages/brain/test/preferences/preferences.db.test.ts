import { turns } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { allowedToolNames } from "../../src/agent/permissions.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import { readProfileSettings, updateProfileSettings } from "../../src/language/settings.ts";
import { createPreferencesService } from "../../src/preferences/index.ts";
import { identity, isolatedDatabase, turn } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  if (database) await database.cleanup();
});

it("FR-A1 saved autonomy governs an existing case while other users keep their level", async () => {
  const owner = await identity(database.db, "L1");
  const other = await identity(database.db, "L1");
  const service = createPreferencesService(database.db, owner.userId);
  const context = await database.db.transaction((tx) => resolveContext(tx, turn, owner));
  expect(allowedToolNames(context.autonomyLevel, context.actorRole)).not.toContain("form.fillLive");
  await service.update({
    autonomyLevel: "L3",
    simpleLanguage: true,
    register: "informal",
    detailLevel: "brief",
    language: "en",
    analyticsConsent: true,
    onboardingCompleted: true,
  });
  const changed = await database.db.transaction((tx) =>
    resolveContext(tx, { ...turn, caseId: context.caseId }, owner),
  );
  expect(changed.autonomyLevel).toBe("L3");
  expect(allowedToolNames(changed.autonomyLevel, changed.actorRole)).toContain("form.fillLive");
  expect(changed.responsePreferences).toEqual({
    language: "en",
    simpleLanguage: true,
    register: "informal",
    detailLevel: "brief",
  });
  expect((await createPreferencesService(database.db, other.userId).read()).autonomyLevel).toBe(
    "L1",
  );
  await service.update({ analyticsConsent: false });
  expect(await service.read()).toMatchObject({
    analyticsConsent: false,
    autonomyLevel: "L3",
    simpleLanguage: true,
    onboardingCompleted: true,
  });
});

it("FR-A1 an active answer must finish before its tool permissions can change", async () => {
  const owner = await identity(database.db, "L2");
  const service = createPreferencesService(database.db, owner.userId);
  const context = await database.db.transaction((tx) => resolveContext(tx, turn, owner));
  const [running] = await database.db.insert(turns).values({ caseId: context.caseId }).returning();
  if (!running) throw new Error("Turn missing");
  await expect(service.update({ autonomyLevel: "L1" })).rejects.toMatchObject({
    code: "PREFERENCES_TURN_RUNNING",
  });
  expect((await service.read()).autonomyLevel).toBe("L2");
  await service.update({ highContrast: true });
  await database.db.update(turns).set({ status: "completed" }).where(eq(turns.id, running.id));
  await service.update({ autonomyLevel: "L1" });
  expect((await service.read()).autonomyLevel).toBe("L1");
});

it("FR-L3 language profiles and accessibility settings share communication preferences", async () => {
  const owner = await identity(database.db, "L2");
  const service = createPreferencesService(database.db, owner.userId);
  await service.update({
    language: "en",
    simpleLanguage: true,
    highContrast: true,
    onboardingCompleted: true,
  });
  expect(await readProfileSettings(database.db, owner.userId)).toMatchObject({
    language: "en",
    simpleLanguage: true,
  });
  await updateProfileSettings(database.db, owner.userId, {
    simpleLanguage: false,
    register: "informal",
  });
  expect(await service.read()).toMatchObject({
    language: "en",
    simpleLanguage: false,
    register: "informal",
    highContrast: true,
    onboardingCompleted: true,
    autonomyLevel: "L2",
  });
  const context = await database.db.transaction((tx) => resolveContext(tx, turn, owner));
  expect(context.profileSettings).toEqual(context.responsePreferences);
});

it("FR-L4 cursor preferences survive profile updates and stay isolated between users", async () => {
  const owner = await identity(database.db);
  const other = await identity(database.db);
  const service = createPreferencesService(database.db, owner.userId);
  expect(await service.read()).toMatchObject({ cursorSize: 24, cursorSpeed: 1 });
  await service.update({ cursorSize: 40, cursorSpeed: 0.5, reducedMotion: true });
  await updateProfileSettings(database.db, owner.userId, { language: "en" });
  expect(await createPreferencesService(database.db, owner.userId).read()).toMatchObject({
    cursorSize: 40,
    cursorSpeed: 0.5,
    reducedMotion: true,
    language: "en",
  });
  expect(await createPreferencesService(database.db, other.userId).read()).toMatchObject({
    cursorSize: 24,
    cursorSpeed: 1,
    reducedMotion: false,
  });
  await expect(service.update({ cursorSize: 100 })).rejects.toThrow();
  await expect(service.update({ cursorSpeed: 0 })).rejects.toThrow();
});
