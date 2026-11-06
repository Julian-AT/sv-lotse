// @vitest-environment jsdom
import type { LotseMessage } from "@lotse/brain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AllowedFillPages } from "../src/features/autonomy/allowed-pages.tsx";
import { AUTONOMY_CHANGED_EVENT } from "../src/features/autonomy/config.ts";
import { AutonomyConfirmation } from "../src/features/autonomy/confirmation.tsx";
import { AutonomySettings } from "../src/features/autonomy/settings.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function proposal(): LotseMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [],
    metadata: {
      autonomyConfirmation: {
        level: "L3",
        actorId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
      },
    },
  };
}

test("FR-A1 renders a one-time card that sends explicit confirmation through the turn", async () => {
  let finish: (() => void) | undefined;
  const onDecision = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const message = proposal();
  const view = render(
    createElement(AutonomyConfirmation, { message, language: "en", active: true, onDecision }),
  );
  expect(screen.getByText(/Switch to L3/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm level change" }));
  expect(onDecision).toHaveBeenCalledExactlyOnceWith("Confirm autonomy level");
  expect(
    screen.getByRole("button", { name: "Confirm level change" }).hasAttribute("disabled"),
  ).toBe(true);
  finish?.();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm level change" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  view.rerender(
    createElement(AutonomyConfirmation, { message, language: "en", active: false, onDecision }),
  );
  expect(screen.queryByRole("button")).toBeNull();
});

test("FR-A1 declines without using the settings endpoint", async () => {
  const onDecision = vi.fn(async () => {});
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    createElement(AutonomyConfirmation, {
      message: proposal(),
      language: "de",
      active: true,
      onDecision,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Bisherige Stufe behalten" }));
  await waitFor(() => expect(onDecision).toHaveBeenCalledExactlyOnceWith("Nein"));
  expect(fetcher).not.toHaveBeenCalled();
});

test("FR-A1 L3 panel shows exact server-reviewed pages and refreshes after a voice turn", async () => {
  // Synthetic HTTPS page isolates rendering; real reviewed policy is exercised by brain DB tests.
  const page = "https://example.org/reviewed-booking";
  let level = "L1";
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.includes("include=fill-pages")
        ? { autonomyLevel: level, allowedFillPages: [page] }
        : { autonomyLevel: level },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(createElement(AutonomySettings, { language: "en" }));
  fireEvent.click(await screen.findByRole("button", { name: "Autonomy: L1 – Show and explain" }));
  expect(screen.queryByText("Verified booking pages (L3 only)")).toBeNull();
  level = "L3";
  window.dispatchEvent(new Event(AUTONOMY_CHANGED_EVENT));
  expect(await screen.findByRole("link", { name: page })).toHaveProperty("href", page);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/settings/autonomy?include=fill-pages",
    expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
  );
});

test("FR-A1 server-provided autonomy stays synchronized with voice changes and refreshed props", async () => {
  const fetcher = vi.fn(async () => Response.json({ autonomyLevel: "L2" }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(createElement(AutonomySettings, { language: "en", initialLevel: "L1" }));
  expect(screen.getByRole("button", { name: "Autonomy: L1 – Show and explain" })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();

  fireEvent(window, new Event(AUTONOMY_CHANGED_EVENT));
  expect(
    await screen.findByRole("button", { name: "Autonomy: L2 – Prepare together" }),
  ).toBeTruthy();

  view.rerender(createElement(AutonomySettings, { language: "en", initialLevel: "L3" }));
  expect(
    screen.getByRole("button", { name: "Autonomy: L3 – Prepare after approval" }),
  ).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);

  view.unmount();
  fireEvent(window, new Event(AUTONOMY_CHANGED_EVENT));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("FR-A1 lists no fill pages when policy is empty and rejects unsafe URLs", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ allowedFillPages: [] }))
    .mockResolvedValueOnce(Response.json({ allowedFillPages: ["javascript:alert(1)"] }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(createElement(AllowedFillPages, { language: "en" }));
  expect(
    await screen.findByText("There are currently no verified booking pages enabled."),
  ).toBeTruthy();
  view.unmount();
  render(createElement(AllowedFillPages, { language: "en" }));
  expect(await screen.findByText("The allowed fill pages could not be loaded.")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
