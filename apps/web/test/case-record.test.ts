import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  buildTimeline,
  handoffFileName,
  loadCaseHistory,
  loadCaseReplay,
  prepareHandoff,
} from "../src/features/workspace/case-record.ts";
import { historyCaseId, historyEntries, userText } from "./fixtures/case-history.ts";

const pdfHeaders = { "Content-Type": "application/pdf" };

test("FR-K4 orders proposals, approvals and actions and drops audit duplicates of approvals", () => {
  const timeline = buildTimeline(historyEntries);
  expect(timeline.map((item) => item.type)).toEqual([
    "action",
    "proposal",
    "approval",
    "action",
    "action",
    "action",
    "action",
  ]);
  expect(timeline[1]).toMatchObject({ tool: "form.prefill", outcome: "done" });
  expect(timeline[2]).toMatchObject({ tool: "form.prefill", decision: "approved", actor: "you" });
  // The approved action follows its decision, not the earlier proposal time.
  expect(timeline[3]).toMatchObject({ subject: { tool: "form.prefill" }, at: timeline[2]?.at });
  expect(timeline[4]).toMatchObject({ subject: { screen: true }, failed: true });
  expect(timeline[5]).toMatchObject({ subject: { event: "step_completed" } });
  expect(timeline[6]).toMatchObject({ subject: { audit: "case.updated" } });
  expect(JSON.stringify(timeline)).not.toContain(userText);
});

test("FR-K4 a replay adds the recorded conversation text to the ordered steps", () => {
  const timeline = buildTimeline(historyEntries, true);
  expect(timeline[0]).toMatchObject({ type: "message", role: "user", text: userText });
  expect(timeline).toHaveLength(8);
});

test("FR-K4 an undecided approval without a recorded proposal is listed as open", () => {
  const [, , , requested] = historyEntries;
  if (!requested) throw new Error("FIXTURE_MISSING");
  expect(buildTimeline([requested])).toEqual([
    expect.objectContaining({ type: "approval", decision: "pending", actor: "you" }),
  ]);
});

test("FR-K4 history and replay loads are authenticated GETs and reject another case's replay", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
    String(url).endsWith("/history")
      ? Response.json({ entries: historyEntries, messages: [] })
      : Response.json({ caseId: randomUUID(), replay: true, messages: [], events: [] }),
  );
  const signal = new AbortController().signal;
  expect(await loadCaseHistory(historyCaseId, signal, fetcher)).toHaveLength(7);
  await expect(loadCaseReplay(historyCaseId, signal, fetcher)).rejects.toMatchObject({
    code: "REPLAY_FAILED",
  });
  for (const [url, init] of fetcher.mock.calls) {
    expect(String(url)).toMatch(new RegExp(`^/api/cases/${historyCaseId}/(history|replay)$`));
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect(init).not.toHaveProperty("method");
  }
});

test("FR-K3 composes the handoff and downloads the PDF from the validated document key", async () => {
  const documentKey = randomUUID();
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json(
          { documentKey, downloadUrl: "https://attacker.example/file.pdf" },
          { status: 201 },
        )
      : new Response(new Uint8Array([37, 80, 68, 70]), { headers: pdfHeaders }),
  );
  const pdf = await prepareHandoff(historyCaseId, fetcher);
  expect(pdf.type).toBe("application/pdf");
  expect(pdf.size).toBe(4);
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    `/api/cases/${historyCaseId}/handoff`,
    `/api/cases/${historyCaseId}/handoff?documentKey=${documentKey}`,
  ]);
});

test("FR-K3 uses a PDF returned directly and reports a busy case", async () => {
  const direct = vi.fn(
    async () => new Response(new Uint8Array([1, 2]), { status: 201, headers: pdfHeaders }),
  );
  expect((await prepareHandoff(historyCaseId, direct)).size).toBe(2);
  expect(direct).toHaveBeenCalledTimes(1);
  await expect(
    prepareHandoff(historyCaseId, async () => Response.json({}, { status: 409 })),
  ).rejects.toMatchObject({ code: "CASE_BUSY" });
  await expect(
    prepareHandoff(historyCaseId, async (_url, init) =>
      init?.method === "POST"
        ? Response.json({ documentKey: randomUUID() }, { status: 201 })
        : Response.json({ error: "not a pdf" }),
    ),
  ).rejects.toMatchObject({ code: "HANDOFF_FAILED" });
});

test("FR-K3 names the summary after the subject without unsafe file name characters", () => {
  expect(handoffFileName("Fallübersicht", "Maria / Muster:")).toBe(
    "Fallübersicht Maria Muster.pdf",
  );
  expect(handoffFileName("Case summary", null)).toBe("Case summary.pdf");
  expect(handoffFileName("Case summary", '  <"|>  ')).toBe("Case summary.pdf");
});
