import type { DatabaseClient } from "@lotse/db";
import { facilities, offices } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { directoryCopy } from "./copy.ts";
import { type DirectoryRecord, directoryRecordSchema } from "./schema.ts";

export function recordSources(
  record: Pick<DirectoryRecord, "sources" | "as_of">,
): { url: string; quote: string; asOf: string }[] {
  return record.sources.map((source) => ({
    url: source.url,
    quote: source.quote,
    asOf: record.as_of,
  }));
}

export function recordAddress(record: DirectoryRecord): {
  street: string;
  postalCode: string;
  city: string;
} {
  return {
    street: record.address?.street ?? "",
    postalCode: record.address?.postal_code ?? "",
    city: record.address?.locality ?? "",
  };
}

export function openingHours(record: DirectoryRecord): string {
  if (typeof record.opening_hours === "string") return record.opening_hours;
  return record.opening_hours
    ? Object.entries(record.opening_hours)
        .map(([day, hours]) => `${directoryCopy.de.weekdays[day] ?? day}: ${hours}`)
        .join("; ")
    : directoryCopy.de.hoursUnknown;
}

export async function facilityRecords(db: DatabaseClient): Promise<DirectoryRecord[]> {
  const rows = await db.select({ record: facilities.record }).from(facilities);
  return rows.map((row) => directoryRecordSchema.parse(row.record));
}

export async function directoryRecord(
  db: DatabaseClient,
  key: string,
): Promise<DirectoryRecord | undefined> {
  const [facility] = await db
    .select({ record: facilities.record })
    .from(facilities)
    .where(eq(facilities.key, key));
  if (facility) return directoryRecordSchema.parse(facility.record);
  const [office] = await db
    .select({ record: offices.record })
    .from(offices)
    .where(eq(offices.key, key));
  return office ? directoryRecordSchema.parse(office.record) : undefined;
}
