// @vitest-environment jsdom
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  preferencesSchema,
} from "@lotse/brain/preferences/schema";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../src/analytics/client.ts", () => ({ setAnalyticsConsent: vi.fn() }));

import { SETTINGS_CONFIG } from "../src/config.ts";
import { AutonomySettings } from "../src/features/autonomy/settings.tsx";
import { serviceIdSchema } from "../src/features/settings/health-schema.ts";
import { inviteScope } from "../src/features/settings/helpers.tsx";
import { panelsCopy } from "../src/features/settings/panels-copy.ts";
import { PrivacyActions } from "../src/features/settings/privacy.tsx";
import { Settings } from "../src/features/settings/settings.tsx";
import { applySpeechPreferences } from "../src/features/settings/speech-preferences.ts";
import { shellCopy } from "../src/features/shell/copy.ts";

let saved: Preferences;
let requests: { url: string; method: string; body: unknown }[];
beforeEach(() => {
  vi.clearAllMocks();
  saved = { ...DEFAULT_PREFERENCES, onboardingCompleted: true };
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url: input, method: init?.method ?? "GET", body });
      if (input === SETTINGS_CONFIG.preferencesUrl) {
        if (init?.method === "PATCH")
          saved = preferencesSchema.parse({ ...saved, ...Object(body) });
        return Response.json(saved);
      }
      if (input === SETTINGS_CONFIG.healthUrl)
        return Response.json({
          checkedAt: new Date().toISOString(),
          connections: serviceIdSchema.options.map((id) => ({
            id,
            status: "missing",
            reason: "not_configured",
          })),
        });
      if (input === SETTINGS_CONFIG.casesUrl) return Response.json([]);
      return Response.json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function showSettings(): ReturnType<typeof render> {
  const view = render(createElement(Settings, { copy: shellCopy.de, initial: saved }));
  const details = view.container.querySelector("details");
  if (!details) throw new Error("Missing settings");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return view;
}

test("profile, voice and consent edits persist and are restored on remount", async () => {
  const view = showSettings();
  fireEvent.change(view.getByLabelText("Anrede"), { target: { value: "informal" } });
  fireEvent.change(view.getByLabelText("Länge der Antworten"), { target: { value: "brief" } });
  fireEvent.click(view.getByLabelText("Einfache Sprache"));
  fireEvent.change(view.getByLabelText("Zeigergröße"), { target: { value: "40" } });
  fireEvent.change(view.getByLabelText("Zeigergeschwindigkeit"), { target: { value: "0.5" } });
  fireEvent.click(view.getByLabelText("Nutzungsstatistik erlauben (freiwillig)"));
  fireEvent.change(view.getByLabelText("Sprechgeschwindigkeit"), { target: { value: "0.5" } });
  fireEvent.click(view.getByRole("button", { name: "Einstellungen speichern" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe("Einstellungen gespeichert."),
  );
  expect(saved).toMatchObject({
    register: "informal",
    detailLevel: "brief",
    simpleLanguage: true,
    analyticsConsent: true,
    speechRate: 0.5,
    cursorSize: 40,
    cursorSpeed: 0.5,
  });
  expect(requests.find((request) => request.method === "PATCH")?.body).not.toHaveProperty(
    "autonomyLevel",
  );
  view.unmount();
  const reloaded = showSettings();
  expect(document.documentElement.dataset.cursorSize).toBe("40");
  expect(document.documentElement.dataset.cursorSpeed).toBe("0.5");
  expect((reloaded.getByLabelText("Zeigergröße") as HTMLSelectElement).value).toBe("40");
  expect((reloaded.getByLabelText("Zeigergeschwindigkeit") as HTMLSelectElement).value).toBe("0.5");
  expect((reloaded.getByLabelText("Anrede") as HTMLSelectElement).value).toBe("informal");
  expect((reloaded.getByLabelText("Sprechgeschwindigkeit") as HTMLSelectElement).value).toBe("0.5");
  expect(
    (reloaded.getByLabelText("Nutzungsstatistik erlauben (freiwillig)") as HTMLInputElement)
      .checked,
  ).toBe(true);
});

test("all six groups expose real health failures with repair actions", async () => {
  const view = showSettings();
  for (const title of [
    "Profil & Sprache",
    "Assistent",
    "Stimme",
    "Datenschutz",
    "Hilfspersonen",
    "Verbindungen",
  ])
    expect(view.getByRole("heading", { name: title })).toBeTruthy();
  const connections = view.getByRole("region", { name: "Verbindungen" });
  await waitFor(() =>
    expect(within(connections).getAllByText("Fehlt / nicht erreichbar")).toHaveLength(6),
  );
  expect(within(connections).queryByText("Verifiziert")).toBeNull();
  expect(within(connections).getAllByText("Verbindung reparieren")).toHaveLength(6);
});

test("autonomy selection makes no write until explicit save", async () => {
  const view = showSettings();
  fireEvent.change(view.getByLabelText("Wie viel darf der Lotse vorbereiten?"), {
    target: { value: "L3" },
  });
  expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Einstellungen speichern" }));
  await waitFor(() => expect(saved.autonomyLevel).toBe("L3"));
});

test("deletion requires the review step and new session uses the actual reset endpoint", async () => {
  const onStatus = vi.fn();
  const view = render(
    createElement(PrivacyActions, {
      copy: panelsCopy.de,
      resetCopy: shellCopy.de,
      onStatus,
      onBusy: vi.fn(),
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "Daten löschen" }));
  expect(requests).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Abbrechen" }));
  expect(requests).toHaveLength(0);
  fireEvent.click(view.getByRole("button", { name: "Daten löschen" }));
  fireEvent.click(view.getByRole("button", { name: "Alle Daten endgültig löschen" }));
  await waitFor(() => expect(onStatus).toHaveBeenCalledWith(panelsCopy.de.deleted));
  expect(requests).toContainEqual({
    url: SETTINGS_CONFIG.deleteUrl,
    method: "DELETE",
    body: undefined,
  });
  fireEvent.click(view.getByRole("button", { name: shellCopy.de.reset }));
  await waitFor(() => expect(onStatus).toHaveBeenCalledWith(shellCopy.de.resetDone));
  expect(requests).toContainEqual({
    url: SETTINGS_CONFIG.sessionUrl,
    method: "DELETE",
    body: undefined,
  });
});

test("helper scope choices never silently include facts or documents", () => {
  expect(inviteScope("none")).toEqual({ mode: "restricted", case: false, factTypes: [] });
  expect(inviteScope("case")).toEqual({ mode: "restricted", case: true, factTypes: [] });
  const factId = "5e771258-0f82-4e4a-a8ba-c05ca0d3a148";
  expect(inviteScope("selected", [factId])).toEqual({
    mode: "restricted",
    case: true,
    factTypes: [],
    factIds: [factId],
  });
});

test("saved fallback voice and speed affect speech, and a different-language voice is ignored", () => {
  const voice = { voiceURI: "unit-voice", lang: "en-GB" } as SpeechSynthesisVoice;
  const utterance = { lang: "en", rate: 1, voice: null } as SpeechSynthesisUtterance;
  applySpeechPreferences(utterance, { speechRate: 0.5, voiceURI: voice.voiceURI }, [voice]);
  expect(utterance.rate).toBe(0.5);
  expect(utterance.voice).toBe(voice);
  const german = { lang: "de-AT", rate: 1, voice: null } as SpeechSynthesisUtterance;
  applySpeechPreferences(german, { speechRate: 1.5, voiceURI: voice.voiceURI }, [voice]);
  expect(german.rate).toBe(1.5);
  expect(german.voice).toBeNull();
});

test("server-provided autonomy cannot be reset by a stale background load before confirmation", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Response.json(
      String(input).includes("include=fill-pages")
        ? { autonomyLevel: "L3", allowedFillPages: [] }
        : { autonomyLevel: "L3" },
    );
  });
  const view = render(createElement(AutonomySettings, { language: "de", initialLevel: "L1" }));
  fireEvent.click(view.getByRole("button", { name: /^Autonomie:/ }));
  fireEvent.change(view.getByLabelText("Gewünschte Stufe"), { target: { value: "L3" } });
  expect(requests).toHaveLength(0);
  const confirm = view.getByRole("button", {
    name: "Stufenwechsel bestätigen",
  }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await waitFor(() => expect(view.getByText("Autonomiestufe gespeichert.")).toBeTruthy());
  expect(requests).toEqual([
    {
      url: "/api/settings/autonomy",
      method: "PATCH",
      body: { autonomyLevel: "L3", confirmed: true },
    },
    {
      url: "/api/settings/autonomy?include=fill-pages",
      method: "GET",
      body: undefined,
    },
  ]);
});
