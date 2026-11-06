import type { DatabaseClient } from "@lotse/db";
import { benefits, facilities, offices } from "@lotse/db/schema";
import { isPortalLoginPage, loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { BOOKING_ALLOWLIST_FILE } from "../config/index.ts";
import { contracts } from "../tools/contracts/index.ts";
import type { AutonomyLevel } from "./schema.ts";

const httpUrl = z.url({ protocol: /^https?$/ });
const source = z.object({
  url: httpUrl,
  quote: z.string().trim().min(1),
  retrieved_at: z.iso.datetime({ offset: true }),
});

const provenance = { sources: z.array(source).min(1), verified_at: z.iso.date() };
const catalogBooking = z.object({
  sources: provenance.sources,
  appointment_channels: z.array(z.unknown()),
});

const onlineChannel = z.object({
  kind: z.literal("online"),
  url: httpUrl,
  verified_at: z.iso.date(),
});

const directoryBooking = z.object({ ...provenance, appointment_channels: z.array(httpUrl) });

/** HTTPS page without URL credentials on an exact allowlisted origin. */
function allowlistedPage(raw: string, origins: readonly string[]): URL | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && !url.username && !url.password && origins.includes(url.origin))
      return url;
  } catch {}
  return;
}

/** Project only sourced, reviewed booking channels. General office URLs grant no fill permission. */
export function verifiedBookingPages(
  origins: readonly string[],
  catalog: readonly unknown[],
  directories: readonly unknown[],
): string[] {
  const pages = new Set<string>();
  const add = (raw: string): void => {
    const url = allowlistedPage(raw, origins);
    if (url) pages.add(url.href);
  };
  for (const raw of catalog) {
    const record = catalogBooking.safeParse(raw);
    if (!record.success) continue;
    for (const channel of record.data.appointment_channels) {
      const parsed = onlineChannel.safeParse(channel);
      if (parsed.success) add(parsed.data.url);
    }
  }
  for (const raw of directories) {
    const record = directoryBooking.safeParse(raw);
    if (record.success) for (const url of record.data.appointment_channels) add(url);
  }
  return [...pages].sort();
}

/** Read on every authorization so removed channels/origins cannot reuse a pending approval. */
export async function readBookingPages(db: Pick<DatabaseClient, "select">): Promise<string[]> {
  return (await readBookingConfiguration(db)).bookingPages;
}

export async function readBookingConfiguration(
  db: Pick<DatabaseClient, "select">,
): Promise<{ allowlist: string[]; bookingPages: string[] }> {
  // The @lotse/knowledge portal policy is the single origin allowlist for portal and booking fills.
  const policy = await loadPortalPolicy(BOOKING_ALLOWLIST_FILE);
  if (!policy.verified_at) throw new Error("BOOKING_POLICY_INVALID");
  const [catalog, facilityRows, officeRows] = await Promise.all([
    db.select({ record: benefits.record }).from(benefits),
    db.select({ record: facilities.record }).from(facilities),
    db.select({ record: offices.record }).from(offices),
  ]);
  const origins = policy.origins.map((entry) => entry.origin);
  return {
    allowlist: origins,
    bookingPages: verifiedBookingPages(
      origins,
      catalog.map((row) => row.record),
      [...facilityRows, ...officeRows].map((row) => row.record),
    ),
  };
}

/** Same path and every query parameter of a reviewed booking URL: part of that booking flow. */
function extendsBookingPage(url: URL, bookingPages: readonly string[]): boolean {
  return bookingPages.some((raw) => {
    const page = new URL(raw);
    return (
      page.origin === url.origin &&
      page.pathname === url.pathname &&
      [...page.searchParams].every(([key, value]) => url.searchParams.getAll(key).includes(value))
    );
  });
}

export interface DomFillPolicy {
  /** Exact HTTPS origins from the @lotse/knowledge portal policy. */
  portalOrigins: readonly string[];
  /** Exact, sourced and reviewed booking URLs (FR-O6). */
  bookingPages: readonly string[];
}

/**
 * FR-D7: official portal forms on allowlisted origins at L2 and L3. FR-O6: reviewed booking pages
 * at L3 only, by exact URL. Login and identity-provider pages never. Typing still needs a
 * server-side approval per ui.fill, and the guide's submit/book deny list applies at execution.
 */
export function domFillIsAllowed(
  raw: string,
  autonomyLevel: AutonomyLevel,
  policy: DomFillPolicy,
): boolean {
  const url = allowlistedPage(raw, policy.portalOrigins);
  if (!url || autonomyLevel === "L1" || isPortalLoginPage(url)) return false;
  if (extendsBookingPage(url, policy.bookingPages))
    return autonomyLevel === "L3" && policy.bookingPages.includes(raw);
  return true;
}

export async function fillIsAllowed(
  db: Pick<DatabaseClient, "select"> | undefined,
  input: unknown,
  context: RuntimeContext,
): Promise<boolean> {
  const parsed = contracts["ui.fill"].input.safeParse(input);
  if (!parsed.success || context.actorRole !== "subject" || context.autonomyLevel === "L1")
    return false;
  const { target } = parsed.data;
  if (target.kind === "ui" || target.kind === "form") return true;
  // Without the store, a booking page cannot be told apart from a portal page: fail closed.
  if (target.kind !== "dom" || !db) return false;
  const { allowlist, bookingPages } = await readBookingConfiguration(db);
  return domFillIsAllowed(target.url, context.autonomyLevel, {
    portalOrigins: allowlist,
    bookingPages,
  });
}
