import { randomUUID } from "node:crypto";
import { FormError } from "@lotse/brain/forms";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  download: vi.fn(),
  viewer: vi.fn(),
  db: {},
}));
vi.mock("../src/server/form-viewer.ts", () => ({ formViewerResponse: mocks.viewer }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: mocks.db }) }));
vi.mock("@lotse/brain/forms", async (original) => ({
  ...(await original<typeof import("@lotse/brain/forms")>()),
  downloadFormPdf: mocks.download,
}));

import { GET } from "../src/app/api/forms/[id]/pdf/route.ts";
import { GET as instancePdfGET } from "../src/app/api/forms/instances/[id]/pdf/route.ts";
import { formPdfUrl } from "../src/features/form-viewer/config.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const id = randomUUID();
const userId = randomUUID();
const request = () => new Request(`https://lotse.test/api/forms/${id}/pdf`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId: randomUUID(), kind: "anonymous" });
  mocks.download.mockResolvedValue(new TextEncoder().encode("%PDF-1.7\n"));
});

test("FR-D6 serves the rendered PDF privately using the authenticated identity", async () => {
  const response = await GET(request(), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toContain("%PDF-");
  expect(mocks.download).toHaveBeenCalledWith(mocks.db, userId, id);
});
test("requires a session and validates ids before accessing forms", async () => {
  expect((await GET(request(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await GET(request(), { params: Promise.resolve({ id }) })).status).toBe(401);
  expect(mocks.download).not.toHaveBeenCalled();
});
test.each([
  ["access_denied", 403],
  ["not_found", 404],
  ["invalid_fields", 409],
] as const)("maps %s without exposing document values", async (code, status) => {
  mocks.download.mockRejectedValue(new FormError(code));
  const response = await GET(request(), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: `FORM_${code.toUpperCase()}` });
});
test("redacts unexpected errors", async () => {
  mocks.download.mockRejectedValue(new Error("private name or account number"));
  const response = await GET(request(), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "FORM_EXPORT_FAILED" });
});

test.each([GET, instancePdfGET])(
  "FR-D5 preserves the original PDF for live viewer overlays on both route aliases",
  async (get) => {
    const viewerRequest = new Request(new URL(formPdfUrl(id), "https://lotse.test"));
    const original = new Response("original PDF");
    mocks.viewer.mockResolvedValue(original);

    const response = await get(viewerRequest, { params: Promise.resolve({ id }) });

    expect(response).toBe(original);
    expect(mocks.viewer).toHaveBeenCalledExactlyOnceWith(viewerRequest, id, "pdf");
    expect(mocks.download).not.toHaveBeenCalled();
  },
);

test("FR-D6 the instance PDF alias exports committed values through the same authenticated adapter", async () => {
  const response = await instancePdfGET(
    new Request(`https://lotse.test/api/forms/instances/${id}/pdf`),
    { params: Promise.resolve({ id }) },
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(mocks.db, userId, id);
  expect(mocks.viewer).not.toHaveBeenCalled();
});
