import { loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { allowedToolNames } from "../../src/agent/permissions.ts";
import {
  domFillIsAllowed,
  fillIsAllowed,
  verifiedBookingPages,
} from "../../src/autonomy/booking.ts";
import { autonomyChangeSchema } from "../../src/autonomy/index.ts";
import { contracts } from "../../src/tools/contracts/index.ts";
import { fillInput } from "../runtime/helpers.ts";

// Synthetic policy records only: these URLs do not claim a real bookable appointment.
const origin = "https://booking.example.org";
const page = `${origin}/appointments?department=public`;
const sources = [
  { url: origin, quote: "Published booking channel", retrieved_at: "2026-11-06T10:00:00Z" },
];
const channel = { kind: "online", url: page, verified_at: "2026-11-06" };
const catalog = { sources, appointment_channels: [channel] };
const context: RuntimeContext = {
  caseId: "case",
  subjectId: "subject",
  actorId: "actor",
  userId: "user",
  sessionId: "session",
  actorRole: "subject",
  autonomyLevel: "L3",
  shareScope: {},
  sentenceIndex: 0,
};

describe("FR-A1 and FR-O6 autonomy policy", () => {
  it("requires explicit confirmation and rejects identity or model-supplied settings fields", () => {
    expect(autonomyChangeSchema.safeParse({ autonomyLevel: "L3", confirmed: true }).success).toBe(
      true,
    );
    for (const input of [
      { autonomyLevel: "L3" },
      { autonomyLevel: "L3", confirmed: false },
      { autonomyLevel: "L4", confirmed: true },
      { autonomyLevel: "L3", confirmed: true, userId: "other" },
    ])
      expect(autonomyChangeSchema.safeParse(input).success).toBe(false);
  });
  it("projects exact reviewed channels only when the origin is allowlisted", () => {
    expect(verifiedBookingPages([origin], [catalog], [])).toEqual([page]);
    expect(verifiedBookingPages([], [catalog], [])).toEqual([]);
    expect(verifiedBookingPages([origin], [{ ...catalog, sources: [] }], [])).toEqual([]);
    expect(
      verifiedBookingPages(
        [origin],
        [{ ...catalog, appointment_channels: [{ ...channel, verified_at: undefined }] }],
        [],
      ),
    ).toEqual([]);
    expect(
      verifiedBookingPages([origin], [], [{ sources, verified_at: "2026-11-06", url: page }]),
    ).toEqual([]);
  });
  it("rejects credential-bearing URLs, insecure pages, and lookalike origins", () => {
    const appointment_channels = [
      { ...channel, url: "https://user:password@booking.example.org/appointments" },
      { ...channel, url: "http://booking.example.org/appointments" },
      { ...channel, url: "https://booking.example.org.attacker.test/appointments" },
    ];
    expect(verifiedBookingPages([origin], [{ sources, appointment_channels }], [])).toEqual([]);
  });
  it("keeps L1 suggest-only and helpers unable to approve at every level", () => {
    for (const level of ["L1", "L2", "L3"] as const) {
      expect(allowedToolNames(level, "helper")).not.toContain("ui.fill");
      expect(allowedToolNames(level, "helper")).not.toContain("form.commitGroup");
    }
    expect(allowedToolNames("L1", "subject")).not.toContain("form.fillLive");
    expect(allowedToolNames("L2", "subject")).toContain("form.fillLive");
  });
  it("allows L2 reviewed viewer fields but never allows L2 booking-page or OS typing", async () => {
    const l2 = { ...context, autonomyLevel: "L2" as const };
    expect(await fillIsAllowed(undefined, fillInput, l2)).toBe(true);
    expect(
      await fillIsAllowed(
        undefined,
        { ...fillInput, target: { kind: "dom", handle: "field", url: page } },
        l2,
      ),
    ).toBe(false);
    expect(
      await fillIsAllowed(
        undefined,
        { ...fillInput, target: { kind: "point", x: 0.5, y: 0.5, confidence: 1, screenIndex: 0 } },
        context,
      ),
    ).toBe(false);
    expect(await fillIsAllowed(undefined, fillInput, { ...context, autonomyLevel: "L1" })).toBe(
      false,
    );
    expect(await fillIsAllowed(undefined, fillInput, { ...context, actorRole: "helper" })).toBe(
      false,
    );
  });
});

// Paths on a real allowlisted origin, used only to exercise the policy. They do not claim that
// a specific application form or booking page exists at these addresses.
const portal = "https://www.oegk.at";
const form = `${portal}/antraege/formular?step=2`;
const booking = `${portal}/cdscontent/?contentid=10007.000001`;
const policy = { portalOrigins: [portal], bookingPages: [booking] };

describe("FR-D7 guided filling on allowlisted portals", () => {
  it("allows DOM fills on portal-policy origins at L2 and L3 but never at L1", async () => {
    const { origins } = await loadPortalPolicy();
    expect(origins.map((entry) => entry.origin)).toContain(portal);
    expect(domFillIsAllowed(form, "L2", policy)).toBe(true);
    expect(domFillIsAllowed(form, "L3", policy)).toBe(true);
    expect(domFillIsAllowed(form, "L1", policy)).toBe(false);
  });
  it("refuses origins outside the portal policy, insecure pages and credential URLs", () => {
    for (const url of [
      "https://portal.example.org/antraege/formular",
      "https://www.oegk.at.attacker.test/antraege/formular",
      "http://www.oegk.at/antraege/formular",
      "https://user:secret@www.oegk.at/antraege/formular",
      "not a url",
    ])
      for (const level of ["L2", "L3"] as const)
        expect(domFillIsAllowed(url, level, policy), `${level} ${url}`).toBe(false);
  });
  it("refuses login and identity-provider pages on allowlisted origins", () => {
    for (const path of [
      "/login",
      "/Login.aspx?ReturnUrl=%2Fantraege",
      "/sign-in",
      "/portal/signIn",
      "/auth/realms/sv/protocol/openid-connect/auth?client_id=web",
      "/sso/start",
      "/antraege?redirect=%2Flogin",
      "/id-austria/start",
      "/einloggen",
      "/konto/passwort-vergessen",
    ])
      for (const level of ["L2", "L3"] as const)
        expect(domFillIsAllowed(`${portal}${path}`, level, policy), `${level} ${path}`).toBe(false);
    expect(domFillIsAllowed(`${portal}/authority/antraege`, "L2", policy)).toBe(true);
  });
  it("keeps reviewed booking pages L3 only and bound to the exact reviewed URL", () => {
    expect(domFillIsAllowed(booking, "L2", policy)).toBe(false);
    expect(domFillIsAllowed(booking, "L3", policy)).toBe(true);
    expect(domFillIsAllowed(`${booking}&slot=1`, "L2", policy)).toBe(false);
    expect(domFillIsAllowed(`${booking}&slot=1`, "L3", policy)).toBe(false);
    expect(domFillIsAllowed(`${booking}#termin`, "L3", policy)).toBe(false);
    // Another page on the same content path is an ordinary portal page, not the booking flow.
    expect(domFillIsAllowed(`${portal}/cdscontent/?contentid=10007.000002`, "L2", policy)).toBe(
      true,
    );
  });
  it("fails closed for DOM fills without the store that knows booking pages", async () => {
    const l2 = { ...context, autonomyLevel: "L2" as const };
    const input = { ...fillInput, target: { kind: "dom", handle: "field", url: form } };
    expect(await fillIsAllowed(undefined, input, l2)).toBe(false);
    expect(await fillIsAllowed(undefined, input, { ...l2, actorRole: "helper" })).toBe(false);
  });
  it("never offers a tool that submits, sends, pays or books at any level", () => {
    for (const level of ["L1", "L2", "L3"] as const)
      for (const role of ["subject", "helper"] as const)
        expect(
          allowedToolNames(level, role).filter((name) =>
            /submit|send|pay|book|confirm|delete|press/iu.test(name),
          ),
        ).toEqual([]);
    // The only click is page navigation: L2/L3 subjects, never helpers or L1. The Mac app follows
    // only links, tabs and accordions on allowlisted pages and denies submit, send, pay and login.
    expect(allowedToolNames("L1", "subject")).not.toContain("ui.click");
    expect(allowedToolNames("L3", "helper")).not.toContain("ui.click");
    expect(allowedToolNames("L3", "subject")).toContain("ui.click");
    const click = { target: { kind: "dom", handle: "ax-1", url: form } };
    expect(contracts["ui.click"].input.safeParse(click).success).toBe(true);
    for (const extra of [{ submit: true }, { value: "x" }, { press: "Enter" }])
      expect(contracts["ui.click"].input.safeParse({ ...click, ...extra }).success).toBe(false);
    expect(
      contracts["ui.click"].input.safeParse({ target: { kind: "point", x: 0.5, y: 0.5 } }).success,
    ).toBe(false);
    // ui.fill can only type a value; there is no field to request a click, press or submit.
    const target = { kind: "dom", handle: "field", url: form };
    expect(contracts["ui.fill"].input.safeParse({ ...fillInput, target }).success).toBe(true);
    for (const extra of [{ action: "click" }, { submit: true }, { press: "Enter" }])
      expect(contracts["ui.fill"].input.safeParse({ ...fillInput, target, ...extra }).success).toBe(
        false,
      );
  });
});
