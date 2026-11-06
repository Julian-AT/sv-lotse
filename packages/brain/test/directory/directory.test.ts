import { describe, expect, it } from "vitest";
import { appointmentCalendar } from "../../src/directory/calendar.ts";
import { evaluateOfficeCondition, selectOfficeReference } from "../../src/directory/conditions.ts";
import { officeSlots } from "../../src/directory/context.ts";
import { distanceKm, resolvePlace } from "../../src/directory/geo.ts";
import { callDrafts, callRehearsal } from "../../src/directory/prepare.ts";
import { openingHours } from "../../src/directory/records.ts";
import { directoryRecordSchema } from "../../src/directory/schema.ts";
import { nearbyFacilities, openingWindowMatch } from "../../src/directory/search.ts";
import { contracts } from "../../src/tools/contracts/index.ts";

// Synthetic directory entries isolate geometry and preference behaviour. Product
// records and the complete tool flow are covered separately against real Postgres.
const source = {
  url: "https://example.org/contact",
  quote: "Contact",
  retrieved_at: "2026-11-06T00:00:00Z",
};
const record = {
  id: "test-directory",
  name_de: "Test centre",
  type: "rehabilitation",
  location: { latitude: 47, longitude: 15 },
  sources: [source],
  as_of: "2026-11-06",
  opening_hours: { monday: "08:00–12:00", tuesday: "08:00–12:00" },
};
const option = {
  id: "directory:test-directory:0",
  facilityId: record.id,
  channel: "phone" as const,
  channels: { phone: "+43 1 123" },
  sources: [{ url: source.url, quote: source.quote, asOf: record.as_of }],
  retrievedAt: source.retrieved_at,
  title: "Anfrage, Büro; Übung\nEND:VEVENT",
  timeWindow: { from: "2026-11-09T09:00:00+01:00", to: "2026-11-09T09:30:00+01:00" },
};

describe("FR-O1 applies catalog rules without guessing missing context", () => {
  it("respects parentheses, precedence, numeric comparison and status aliases", async () => {
    const slots = await officeSlots({ carrier: "SVS", subjectStatus: "pensioner", region: "Wien" });
    expect(
      evaluateOfficeCondition(
        "pension_source == 'gsvg-bsvg' and (region == 'Wien' or region == 'Tirol')",
        slots,
      ),
    ).toBe(true);
    expect(evaluateOfficeCondition("false and true or age >= 18", { age: 18 })).toBe(true);
    expect(evaluateOfficeCondition("status == 'dependent'", { status: "dependent" })).toBe(true);
  });
  it("keeps unknown inequalities and negation unknown and rejects executable text", () => {
    expect(evaluateOfficeCondition("not missing", {})).toBeNull();
    expect(evaluateOfficeCondition("missing != 'other'", {})).toBeNull();
    expect(evaluateOfficeCondition("true or missing", {})).toBe(true);
    expect(evaluateOfficeCondition("false and missing", {})).toBe(false);
    expect(() => evaluateOfficeCondition("process.exit()", {})).toThrow();
  });
  it("does not mistake a pensioner's health carrier for a pension carrier", async () => {
    const slots = await officeSlots({
      carrier: "oegk",
      subjectStatus: "pensioner",
      region: "Wien",
    });
    expect(slots.pension_source).toBeUndefined();
  });
  it("asks for a missing discriminator even when another office rule matches", () => {
    expect(() =>
      selectOfficeReference(
        [
          { when: "true", office: "first" },
          { when: "district == 'north'", office: "second" },
        ],
        {},
      ),
    ).toThrow("OFFICE_CONTEXT_REQUIRED");
  });
});

describe("FR-O2 searches with bundled Austrian postcode centroids", () => {
  it("resolves Vienna, Graz and another province without a network service", async () => {
    const vienna = await resolvePlace("1010");
    const graz = await resolvePlace("AT-8010 Graz");
    expect(vienna.lat).toBeGreaterThan(48);
    expect(graz.lat).toBeGreaterThan(47);
    expect((await resolvePlace("Wien")).lat).toBeGreaterThan(48);
    expect((await resolvePlace("Graz")).lat).toBeGreaterThan(47);
    expect(await resolvePlace("6020")).toMatchObject({ lat: expect.any(Number) });
    expect(distanceKm(vienna, graz)).toBeGreaterThan(140);
    expect(distanceKm(vienna, graz)).toBeLessThan(160);
    await expect(resolvePlace("0000")).rejects.toThrow("PLACE_NOT_FOUND");
  });
  it("sorts by actual unrounded distance and excludes facilities outside the radius", () => {
    const far = { ...record, id: "further", location: { latitude: 48, longitude: 16 } };
    expect(
      nearbyFacilities([far, record], "rehabilitation", { lat: 47, lon: 15 }, 10, {}).map(
        (result) => result.record.id,
      ),
    ).toEqual([record.id]);
    expect(distanceKm({ lat: 47, lon: 15 }, { lat: 47, lon: 15 })).toBe(0);
  });
});

describe("FR-O3–O5 prepares drafts and filters verified preferences", () => {
  it("preserves free-text published hours without claiming a verified contact window", () => {
    const hours = "Contact hours by arrangement";
    const parsed = directoryRecordSchema.parse({ ...record, opening_hours: hours });
    expect(openingHours(parsed)).toBe(hours);
    expect(openingWindowMatch(parsed, option.timeWindow)).toBeNull();
  });
  it("excludes known language and accessibility mismatches, keeping unknown details explicit", () => {
    expect(
      nearbyFacilities(
        [{ ...record, languages: ["de"], accessibility_features: ["step-free"] }],
        undefined,
        { lat: 47, lon: 15 },
        1,
        { language: "en" },
      ),
    ).toHaveLength(0);
    expect(
      nearbyFacilities(
        [{ ...record, accessibility_features: [] }],
        undefined,
        { lat: 47, lon: 15 },
        1,
        { accessibility: ["step-free"] },
      ),
    ).toHaveLength(0);
    expect(
      nearbyFacilities([record], undefined, { lat: 47, lon: 15 }, 1, {
        language: "en",
        accessibility: ["step-free"],
      }),
    ).toHaveLength(1);
  });
  it("compares opening hours in Vienna time with explicit date ranges", () => {
    expect(openingWindowMatch(record, option.timeWindow)).toBe(true);
    expect(
      openingWindowMatch(record, {
        from: "2026-11-09T14:00:00+01:00",
        to: "2026-11-09T15:00:00+01:00",
      }),
    ).toBe(false);
    expect(
      openingWindowMatch(record, {
        from: "2026-11-08T09:00:00+01:00",
        to: "2026-11-08T10:00:00+01:00",
      }),
    ).toBeNull();
  });
  it("handles both the spring clock jump and the repeated autumn hour", () => {
    const spring = { ...record, opening_hours: { sunday: "03:00–04:00" } };
    expect(
      openingWindowMatch(spring, {
        from: "2026-03-29T01:30:00+01:00",
        to: "2026-03-29T04:00:00+02:00",
      }),
    ).toBe(true);
    const autumn = { ...record, opening_hours: { sunday: "02:00–02:20" } };
    expect(
      openingWindowMatch(autumn, {
        from: "2026-10-25T02:45:00+02:00",
        to: "2026-10-25T02:30:00+01:00",
      }),
    ).toBe(true);
  });
  it("exports an escaped tentative UTC hold with stable identity and folded UTF-8 lines", () => {
    const ics = appointmentCalendar("case", option, new Date("2026-11-06T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261109T080000Z\r\nDTEND:20261109T083000Z");
    expect(ics).toContain("STATUS:TENTATIVE");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(ics.match(/^END:VEVENT$/gm)).toHaveLength(1);
    for (const line of ics.split("\r\n"))
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    const uid = (text: string): string | undefined => text.match(/^UID:(.*)/m)?.[1];
    expect(uid(ics)).toBe(
      uid(appointmentCalendar("case", option, new Date("2026-11-07T00:00:00Z"))),
    );
    const { timeWindow: _window, ...withoutWindow } = option;
    expect(appointmentCalendar("case", withoutWindow, new Date())).toBe("");
  });
  it("rehearses administrative questions without promising an actual provider response", () => {
    const drafts = callDrafts(option, []);
    expect(drafts.callSheet).toContain("Welche Unterlagen");
    expect(drafts.emailDraft).toContain("[Name bitte ergänzen]");
    const rehearsal = callRehearsal(drafts.callSheet);
    expect(rehearsal.notice).toContain("kein echter Anruf");
    expect(rehearsal.script.map((line) => line.role)).toContain("caller");
  });
  it("rejects reversed time windows at the tool boundary", () => {
    expect(
      contracts["appointment.search"].input.safeParse({
        preferences: {
          timeWindow: { from: "2026-11-09T10:00:00Z", to: "2026-11-09T09:00:00Z" },
          maxDistanceKm: 10,
          language: "de",
          accessibility: [],
        },
      }).success,
    ).toBe(false);
  });
});
