// @vitest-environment jsdom
import { DEFAULT_PREFERENCES } from "@lotse/brain/preferences/schema";
import letter from "@lotse/knowledge/demo/onboarding-letter";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const execute = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@lotse/guide", async (original) => ({
  ...(await original<typeof import("@lotse/guide")>()),
  createGuide: () => ({ execute, dispose: vi.fn(), clear: vi.fn() }),
}));

import { Onboarding } from "../src/features/settings/onboarding.tsx";
import { OnboardingTutorial } from "../src/features/settings/onboarding-tutorial.tsx";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the tutorial quotes the knowledge document, fills a draft and requires explicit group confirmation", async () => {
  const view = render(
    createElement(OnboardingTutorial, {
      preferences: { ...DEFAULT_PREFERENCES, reducedMotion: true },
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "Beispielbrief öffnen" }));
  expect(view.getByRole("article").textContent).toContain(letter.notice);
  fireEvent.click(view.getByRole("button", { name: "Satz zeigen" }));
  await waitFor(() =>
    expect(view.container.querySelector("mark")?.textContent).toBe(letter.highlightQuote),
  );
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "highlight",
      target: { kind: "text", quote: letter.highlightQuote },
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "Beispielfeld ausfüllen" }));
  await waitFor(() =>
    expect((view.getByLabelText(letter.field.label) as HTMLInputElement).value).toBe(
      letter.field.value,
    ),
  );
  expect(view.getByText("Entwurf")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Feldgruppe bestätigen" }),
    ),
  );
  expect(view.queryByText("Bestätigt")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Feldgruppe bestätigen" }));
  expect(view.getByText("Bestätigt")).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("nichts gespeichert oder abgesendet");
  fireEvent.click(view.getByRole("button", { name: "Erneut ausprobieren" }));
  expect(view.queryByRole("article")).toBeNull();
  expect(view.getByRole("button", { name: "Beispielbrief öffnen" })).toBeTruthy();
});

test("skipping the tutorial finishes onboarding without creating a fact, document or model turn", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ ...DEFAULT_PREFERENCES, onboardingCompleted: true }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(createElement(Onboarding, { initial: { ...DEFAULT_PREFERENCES } }));
  for (let step = 0; step < 3; step++)
    fireEvent.click(view.getByRole("button", { name: /^Weiter$/ }));
  fireEvent.click(view.getByRole("button", { name: "Übung überspringen und starten" }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/preferences",
    expect.objectContaining({
      method: "PATCH",
      body: expect.stringContaining('"onboardingCompleted":true'),
    }),
  );
  expect(execute).not.toHaveBeenCalled();
});
