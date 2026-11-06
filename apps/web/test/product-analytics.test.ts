import { randomUUID } from "node:crypto";
import {
  actionEvent,
  guardEvent,
  helperSessionEvent,
  type ProductEvent,
  packageBuiltEvent,
  stepCompletedEvent,
  toolProductEvent,
} from "@lotse/brain/telemetry";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  workspace: vi.fn(),
  confirmFact: vi.fn(),
  editFact: vi.fn(),
  upload: vi.fn(),
  storeUpload: vi.fn(),
  compose: vi.fn(),
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({
    POSTHOG_KEY: "unit-project-key",
    POSTHOG_HOST: "https://analytics.example",
    SESSION_SECRET: "test-document-session-secret-with-32-characters",
    LOTSE_WORKSPACE_URL: "https://lotse.test",
  }),
}));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {},
}));
vi.mock("../src/server/resources.ts", () => ({
  getDatabase: () => ({ db: {} }),
  getStorage: () => ({}),
}));
vi.mock("../src/server/workspace.ts", () => ({ casesResponse: mocks.workspace }));
vi.mock("@lotse/brain/documents", async (original) => ({
  ...(await original<typeof import("@lotse/brain/documents")>()),
  storeDocumentUpload: mocks.storeUpload,
  createDocumentService: () => mocks,
}));
vi.mock("@lotse/brain/case-file", async (original) => ({
  ...(await original<typeof import("@lotse/brain/case-file")>()),
  createHandoffService: () => mocks,
}));

import { analyticsSink, emitAnalytics } from "../src/analytics/emit.ts";
import { parseAnalyticsEvent } from "../src/analytics/events.ts";
import {
  caseStarted,
  documentImported,
  factsConfirmed,
  handoffCreated,
  onboardingStepCompleted,
} from "../src/analytics/product.ts";
import { POST as createCase } from "../src/app/api/cases/route.ts";
import { POST as upload } from "../src/app/api/documents/route.ts";
import { POST as confirmFact, PATCH as editFact } from "../src/app/api/facts/route.ts";
import { handoffResponse } from "../src/server/case-file.ts";

const consented = { cookie: "lotse_analytics_enabled=1", origin: "https://lotse.test" };
const subjectId = randomUUID();
const fetcher = vi.fn();
function sentEvents(): unknown[] {
  return fetcher.mock.calls.map(([, init]) => {
    const body = JSON.parse(String(init?.body));
    const { $process_person_profile, $geoip_disable, $ip, ...properties } = body.properties;
    return { event: body.event, properties };
  });
}
function json(url: string, body: unknown, method = "POST", headers = consented): Request {
  return new Request(url, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  mocks.session.mockResolvedValue({ userId: randomUUID(), sessionId: randomUUID() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("section 15 brain and web emitters build only schema-valid events", () => {
  const context = { autonomyLevel: "L2", actorRole: "subject" } as const;
  const formInstanceId = randomUUID();
  const events: unknown[] = [
    caseStarted(),
    documentImported("upload", "application/pdf", 3),
    documentImported("file", "image/jpeg", 0),
    factsConfirmed("administrative_fact", true),
    handoffCreated(),
    onboardingStepCompleted(1, 100, 1350.4),
    actionEvent("action_proposed", { toolName: "form.commitGroup", input: {} }, "L3"),
    actionEvent(
      "action_approved",
      {
        toolName: "ui.fill",
        input: { target: { kind: "form", formInstanceId, fieldId: "name" } },
      },
      "L2",
    ),
    actionEvent("action_rejected", { toolName: "calendar.createEvent", input: {} }, "L2"),
    stepCompletedEvent("praevention-vorsorgeuntersuchung", "prepare-access", context),
    packageBuiltEvent("0b4e7a40-5d0c-4c51-9a6e-2f1d3c4b5a69", 2),
    toolProductEvent(
      "form.prefill",
      { templateId: "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f", caseId: "c", subjectId: "s" },
      { formInstanceId, proposals: [], missingFields: ["a", "b"] },
    ),
    toolProductEvent("handoff.compose", { caseId: "c", scope: [] }, { documentKey: "k" }),
    helperSessionEvent("helper_session_started", "full"),
    helperSessionEvent("helper_session_ended", "screen", 61_000.7),
    guardEvent({ text: "", disposition: "handoff", reason: "classifier" }),
    guardEvent({ text: "", disposition: "rewrite", reason: "allowed" }),
    { event: "safety_net_triggered", properties: { pattern_category: "crisis" } },
  ];
  for (const event of events) expect(parseAnalyticsEvent(event)).toEqual(event);
  expect(guardEvent({ text: "", disposition: "allow", reason: "allowed" })).toBeUndefined();
  expect(toolProductEvent("kb.search", {}, [])).toBeUndefined();
});

test("section 15 server emitters send nothing without explicit consent", async () => {
  const request = new Request("https://lotse.test/api/cases", { method: "POST" });
  await emitAnalytics(request, caseStarted());
  const sink = analyticsSink(
    new Request("https://lotse.test", { headers: { cookie: "lotse_analytics_enabled=0" } }),
  );
  await sink(handoffCreated());
  expect(fetcher).not.toHaveBeenCalled();
});

test("section 15 server emitters send one validated event per call with consent", async () => {
  const sink = analyticsSink(new Request("https://lotse.test", { headers: consented }));
  const event: ProductEvent = helperSessionEvent("helper_session_ended", "restricted", 5_000);
  await sink(event);
  await sink({ event: "handoff_created", properties: { reason_category: "Private Text" } });
  expect(sentEvents()).toEqual([event]);
});

test("section 15 a failing provider never breaks the product action", async () => {
  fetcher.mockRejectedValue(new Error("provider down"));
  await expect(
    emitAnalytics(new Request("https://lotse.test", { headers: consented }), caseStarted()),
  ).resolves.toBeUndefined();
});

test("section 15 case creation emits case_started only on success", async () => {
  mocks.workspace.mockResolvedValueOnce(Response.json({ case: { id: "case" } }));
  const response = await createCase(
    new Request("https://lotse.test/api/cases", { method: "POST", headers: consented }),
  );
  expect(response.status).toBe(200);
  mocks.workspace.mockResolvedValueOnce(Response.json({ error: "x" }, { status: 503 }));
  await createCase(
    new Request("https://lotse.test/api/cases", { method: "POST", headers: consented }),
  );
  expect(sentEvents()).toEqual([caseStarted()]);
});

test("section 15 document imports emit channel, media type and page count only", async () => {
  mocks.upload.mockResolvedValue({
    documentId: randomUUID(),
    subjectId,
    ocrStatus: "completed",
    pageCount: 4,
    mediaType: "application/pdf",
  });
  const form = new FormData();
  form.set("file", new File(["%PDF-content"], "private-name.pdf", { type: "application/pdf" }));
  form.set("subjectId", subjectId);
  form.set("type", "Befund von Frau Muster");
  const response = await upload(
    new Request("https://lotse.test/api/documents", {
      method: "POST",
      headers: consented,
      body: form,
    }),
  );
  expect(response.status).toBe(201);
  expect(sentEvents()).toEqual([documentImported("upload", "application/pdf", 4)]);
});

test("section 15 confirming and editing facts emits type counts and edit counts", async () => {
  mocks.confirmFact.mockResolvedValue({ id: randomUUID(), type: "administrative_fact" });
  mocks.editFact.mockResolvedValue({ id: randomUUID(), type: "administrative_fact" });
  await confirmFact(
    json("https://lotse.test/api/facts", { proposalToken: "token", confirmed: true }),
  );
  await editFact(
    json(
      "https://lotse.test/api/facts",
      { subjectId, factId: randomUUID(), value: "private value", confirmed: true },
      "PATCH",
    ),
  );
  expect(sentEvents()).toEqual([
    factsConfirmed("administrative_fact", false),
    factsConfirmed("administrative_fact", true),
  ]);
  expect(JSON.stringify(sentEvents())).not.toContain("private value");
});

test("section 15 a requested handoff emits handoff_created", async () => {
  mocks.compose.mockResolvedValue({ documentKey: randomUUID() });
  const response = await handoffResponse(
    json(`https://lotse.test/api/cases/${randomUUID()}/handoff`, {}),
    randomUUID(),
  );
  expect(response.status).toBe(201);
  expect(sentEvents()).toEqual([handoffCreated()]);
});
