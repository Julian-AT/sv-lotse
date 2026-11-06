import type { DatabaseClient } from "@lotse/db";
import { profiles, users } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const ProfileSettingsSchema = z.strictObject({
  language: z.enum(["de", "en"]),
  simpleLanguage: z.boolean(),
  register: z.enum(["formal", "informal"]),
  detailLevel: z.enum(["brief", "standard", "detailed"]),
});
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
export const ProfileSettingsPatchSchema = ProfileSettingsSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
);
export type ProfileSettingsPatch = z.infer<typeof ProfileSettingsPatchSchema>;
export const DEFAULT_PROFILE_SETTINGS: Readonly<ProfileSettings> = {
  language: "de",
  simpleLanguage: false,
  register: "formal",
  detailLevel: "standard",
};

/** Read presentation settings while retaining legacy language-column simple mode. */
export function settingsFromProfile(
  profile?: {
    language: string;
    register: string;
    detailLevel: string;
    preferences?: unknown;
  } | null,
): ProfileSettings {
  if (!profile) return { ...DEFAULT_PROFILE_SETTINGS };
  const language = profile.language.toLowerCase();
  const presentation = z
    .object({ simpleLanguage: z.boolean().optional() })
    .safeParse(profile.preferences);
  return ProfileSettingsSchema.parse({
    language: language === "en" || language.startsWith("en-") ? "en" : "de",
    simpleLanguage:
      (presentation.success ? presentation.data.simpleLanguage : undefined) ??
      language.endsWith("-simple"),
    register: profile.register,
    detailLevel: profile.detailLevel,
  });
}

export async function readProfileSettings(
  db: DatabaseClient,
  userId: string,
): Promise<ProfileSettings> {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, z.uuid().parse(userId)));
  return settingsFromProfile(profile);
}

export async function updateProfileSettings(
  db: DatabaseClient,
  userId: string,
  input: unknown,
): Promise<ProfileSettings> {
  const patch = ProfileSettingsPatchSchema.parse(input);
  const id = z.uuid().parse(userId);
  return db.transaction(async (tx) => {
    // Settings and autonomy writes share the turn-creation lock.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for("update");
    await tx.insert(profiles).values({ userId: id }).onConflictDoNothing();
    const [current] = await tx.select().from(profiles).where(eq(profiles.userId, id)).for("update");
    const settings = ProfileSettingsSchema.parse({ ...settingsFromProfile(current), ...patch });
    await tx
      .update(profiles)
      .set({
        language: `${settings.language === "de" ? "de-AT" : "en"}${settings.simpleLanguage ? "-simple" : ""}`,
        register: settings.register,
        detailLevel: settings.detailLevel,
        preferences: { ...current?.preferences, simpleLanguage: settings.simpleLanguage },
      })
      .where(eq(profiles.userId, id));
    return settings;
  });
}
