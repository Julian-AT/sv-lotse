// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CaseHandoff } from "../src/features/workspace/case-handoff.tsx";
import { CaseHistory } from "../src/features/workspace/case-history.tsx";
import { CaseRecord } from "../src/features/workspace/case-record.tsx";
import { CASE_REPLAY_STEP_MS } from "../src/features/workspace/config.ts";
import { workspaceCopy } from "../src/features/workspace/copy.ts";
import { historyCaseId, historyEntries, userText } from "./fixtures/case-history.ts";

const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
const documentKey = randomUUID();
// Test-only HTTP double for the case routes; the routes are covered against real services.
function routes(subjectName = "Josef Huber") {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/handoff") && init?.method === "POST")
      return Response.json({ documentKey, downloadUrl: "/elsewhere" }, { status: 201 });
    if (url.includes("/handoff?documentKey="))
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        headers: { "Content-Type": "application/pdf" },
      });
    if (url.endsWith("/history")) return Response.json({ entries: historyEntries, messages: [] });
    if (url.endsWith("/replay"))
      return Response.json({
        caseId: historyCaseId,
        replay: true,
        messages: [],
        events: historyEntries,
      });
    if (url === `/api/cases/${historyCaseId}`)
      return Response.json({ subject: { displayName: subjectName } });
    return new Response(null, { status: 404 });
  });
}

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:case-summary"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.assign(URL, objectUrls);
});

test("FR-K3 Übergabe vorbereiten offers the case summary PDF named after the subject", async () => {
  const fetch = routes();
  vi.stubGlobal("fetch", fetch);
  render(
    createElement(CaseHandoff, {
      caseId: historyCaseId,
      subjectName: "Maria Muster",
      copy: workspaceCopy.de,
      language: "de",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Übergabe vorbereiten" }));
  const link = await screen.findByRole("link", { name: "Fallübersicht herunterladen" });
  expect(link.getAttribute("download")).toBe("Fallübersicht Maria Muster.pdf");
  expect(link.getAttribute("href")).toBe("blob:case-summary");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  expect(String(fetch.mock.calls[1]?.[0])).toBe(
    `/api/cases/${historyCaseId}/handoff?documentKey=${documentKey}`,
  );
});

test("FR-K3 the case page looks up the subject name and shows a busy case without a download", async () => {
  vi.stubGlobal("fetch", routes());
  render(createElement(CaseRecord, { caseId: historyCaseId, language: "en" }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare handoff" }));
  const link = await screen.findByRole("link", { name: "Download case summary" });
  expect(link.getAttribute("download")).toBe("Case summary Josef Huber.pdf");
  cleanup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "CASE_CASE_BUSY" }, { status: 409 })),
  );
  render(
    createElement(CaseHandoff, {
      caseId: historyCaseId,
      subjectName: "Maria Muster",
      copy: workspaceCopy.de,
      language: "de",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Übergabe vorbereiten" }));
  expect((await screen.findByRole("alert")).textContent).toBe(workspaceCopy.de.record.handoffBusy);
  expect(screen.queryByRole("link")).toBeNull();
});

test("FR-K4 Verlauf lists proposals, approvals with decision and actor, and actions in order", async () => {
  vi.stubGlobal("fetch", routes());
  const { container } = render(
    createElement(CaseHistory, {
      caseId: historyCaseId,
      copy: workspaceCopy.de,
      language: "de",
    }),
  );
  expect(screen.getByRole("heading", { name: "Verlauf" })).toBeTruthy();
  await waitFor(() => expect(container.querySelectorAll("li")).toHaveLength(7));
  const rows = [...container.querySelectorAll("li")].map((row) => row.textContent ?? "");
  expect(rows[0]).toContain("Informationen sammeln");
  expect(rows[1]).toContain("VorschlagAntrag vorbereitenErledigt");
  expect(rows[2]).toContain("BestätigungAntrag vorbereitenBestätigt durch Sie");
  expect(rows[3]).toContain("AktionAntrag vorbereitenErledigt");
  expect(rows[4]).toContain("Aktion am BildschirmNicht gelungen");
  expect(rows[5]).toContain("Schritt abgeschlossen");
  expect(rows[6]).toContain("Fall aktualisiert");
  expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(historyEntries[1]?.at);
  expect(container.textContent).not.toContain(userText);
});

test("FR-K4 Abspielen steps through GET /replay without executing anything", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const fetch = routes();
  vi.stubGlobal("fetch", fetch);
  render(
    createElement(CaseHistory, {
      caseId: historyCaseId,
      copy: workspaceCopy.de,
      language: "de",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Abspielen" }));
  await screen.findByText("Schritt 1 von 8");
  expect(screen.getByText(userText).closest("li")?.getAttribute("aria-current")).toBe("step");
  act(() => {
    vi.advanceTimersByTime(CASE_REPLAY_STEP_MS);
  });
  expect(screen.getByText("Schritt 2 von 8")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Anhalten" }));
  fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
  expect(screen.getByText("Schritt 3 von 8")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(CASE_REPLAY_STEP_MS * 3);
  });
  expect(screen.getByText("Schritt 3 von 8")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect(screen.getByText("Schritt 2 von 8")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Wiedergabe beenden" }));
  expect(screen.queryByText(/Schritt \d von 8/)).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/replay"))).toBe(true);
  for (const [, init] of fetch.mock.calls) expect(init?.method).toBeUndefined();
});
