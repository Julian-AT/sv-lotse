import { readFile } from "node:fs/promises";
import type { DatabaseClient } from "@lotse/db";
import { benefits } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { parse } from "yaml";
import { z } from "zod";
import type { contracts } from "../tools/contracts/index.ts";
import { directoryCopy } from "./copy.ts";
import { directoryRecord, openingHours, recordAddress, recordSources } from "./records.ts";
import {
  DirectoryError,
  type DirectoryRecord,
  directoryBenefitSchema,
  type TimeWindow,
} from "./schema.ts";

export type AppointmentOption = z.infer<(typeof contracts)["appointment.search"]["output"]>[number];
const allowlistSchema = z.object({
  origins: z.array(z.object({ origin: z.url({ protocol: /^https?$/ }) })),
});

let origins: Promise<Set<string>> | undefined;

function earliestRetrieval(sources: readonly { retrieved_at: string }[]): string | undefined {
  return sources
    .map((source) => source.retrieved_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

async function allowedOnline(url: string): Promise<boolean> {
  origins ??= readFile(new URL("../../../knowledge/allowlist.yaml", import.meta.url), "utf8").then(
    (text) => new Set(allowlistSchema.parse(parse(text)).origins.map((entry) => entry.origin)),
  );
  const target = new URL(url);
  return !target.username && !target.password && (await origins).has(target.origin);
}

export async function directoryOptions(
  record: DirectoryRecord,
  timeWindow?: TimeWindow,
): Promise<AppointmentOption[]> {
  const channels: {
    channel: AppointmentOption["channel"];
    channels: AppointmentOption["channels"];
  }[] = [];
  if (record.phone) channels.push({ channel: "phone", channels: { phone: record.phone } });
  if (record.email) channels.push({ channel: "email", channels: { email: record.email } });
  for (const url of record.appointment_channels ?? []) {
    if (await allowedOnline(url))
      channels.push({ channel: "online", channels: { onlineUrl: url } });
  }
  const retrievedAt = earliestRetrieval(record.sources);
  if (!retrievedAt) throw new DirectoryError("APPOINTMENT_NOT_FOUND");
  return channels.map((channel, index) => ({
    id: `directory:${record.id}:${index}`,
    facilityId: record.id,
    ...channel,
    title: record.name_de,
    address: recordAddress(record),
    openingHours: openingHours(record),
    sources: recordSources(record),
    retrievedAt,
    notice: directoryCopy.de.noBooking,
    ...(timeWindow ? { timeWindow } : {}),
  }));
}

export async function catalogOptions(
  db: DatabaseClient,
  benefitId: string,
  timeWindow?: TimeWindow,
): Promise<AppointmentOption[]> {
  const [row] = await db
    .select({ record: benefits.record })
    .from(benefits)
    .where(eq(benefits.key, benefitId));
  if (!row) throw new DirectoryError("BENEFIT_NOT_FOUND");
  const benefit = directoryBenefitSchema.parse(row.record);
  const retrievedAt = earliestRetrieval(benefit.sources);
  if (!retrievedAt) return [];
  const results: AppointmentOption[] = [];
  for (const [index, channel] of benefit.appointment_channels.entries()) {
    if (channel.kind === "online" && !(await allowedOnline(channel.url))) continue;
    const channels =
      channel.kind === "phone"
        ? { phone: channel.number }
        : channel.kind === "online"
          ? { onlineUrl: channel.url }
          : { email: decodeURIComponent(new URL(channel.url).pathname) };
    results.push({
      id: `catalog:${benefit.id}:${index}`,
      facilityId: benefit.id,
      channel: channel.kind,
      channels,
      title: benefit.name_de,
      sources: recordSources(benefit),
      retrievedAt,
      notice: directoryCopy.de.noBooking,
      unverifiedPreferences: ["distance", "openingHours", "language", "accessibility"],
      ...(timeWindow ? { timeWindow } : {}),
    });
  }
  return results;
}

/** Rebuild canonical contact details: caller-supplied sources and destinations are untrusted. */
export async function canonicalOption(
  db: DatabaseClient,
  supplied: AppointmentOption,
): Promise<AppointmentOption> {
  const [kind, key] = supplied.id.split(":");
  if (!key || supplied.facilityId !== key) throw new DirectoryError("APPOINTMENT_NOT_FOUND");
  const candidates =
    kind === "catalog"
      ? await catalogOptions(db, key, supplied.timeWindow)
      : kind === "directory"
        ? await optionsForDirectory(db, key, supplied.timeWindow)
        : [];
  const match = candidates.find(
    (candidate) => candidate.id === supplied.id && candidate.channel === supplied.channel,
  );
  if (!match) throw new DirectoryError("APPOINTMENT_NOT_FOUND");
  return {
    ...match,
    ...(supplied.requestedPreferences
      ? { requestedPreferences: supplied.requestedPreferences }
      : {}),
  };
}

async function optionsForDirectory(
  db: DatabaseClient,
  key: string,
  timeWindow?: TimeWindow,
): Promise<AppointmentOption[]> {
  const record = await directoryRecord(db, key);
  return record ? directoryOptions(record, timeWindow) : [];
}
