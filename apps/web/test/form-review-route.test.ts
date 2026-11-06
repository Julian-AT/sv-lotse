import { randomUUID } from "node:crypto";
import { FormError } from "@lotse/brain/forms";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), review: vi.fn(), db: {} }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: mocks.db }) }));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("@lotse/brain/forms", async (original) => ({
  ...(await original<typeof import("@lotse/brain/forms")>()),
  reviewTemplate: mocks.review,
}));

import { PATCH } from "../src/app/api/forms/templates/[id]/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const id = randomUUID();
const userId = randomUUID();
const input = {
  formInstanceId: randomUUID(),
  fields: [
    {
      id: "field-a",
      label_de: "Name",
      type: "text",
      owner: "applicant",
      box: { page: 1, x: 10, y: 20, width: 100, height: 30 },
    },
  ],
};

const request = (body: unknown = input, origin = "https://lotse.test") =>
  new Request(`https://lotse.test/api/forms/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId: randomUUID(), kind: "anonymous" });
  mocks.review.mockResolvedValue({
    templateId: randomUUID(),
    status: "verified",
    fields: input.fields,
  });
});

test("FR-D11 PATCH binds review to the session user and returns a private verified version", async () => {
  const response = await PATCH(request(), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.review).toHaveBeenCalledExactlyOnceWith(mocks.db, userId, id, input);
  expect(await response.json()).toMatchObject({ status: "verified" });
});
test("FR-D11 PATCH rejects missing sessions, cross-origin writes and caller-controlled mappings", async () => {
  mocks.session.mockRejectedValueOnce(new SessionUnauthorized());
  expect((await PATCH(request(), context)).status).toBe(401);
  expect((await PATCH(request(input, "https://other.test"), context)).status).toBe(403);
  expect((await PATCH(request({ ...input, userId }), context)).status).toBe(400);
  expect((await PATCH(request(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
  expect(mocks.review).not.toHaveBeenCalled();
});
test.each([
  ["access_denied", 403],
  ["not_found", 404],
  ["invalid_fields", 409],
] as const)("FR-D11 PATCH maps %s without exposing user content", async (code, status) => {
  mocks.review.mockRejectedValue(new FormError(code));
  const response = await PATCH(request(), context);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: "FORM_REVIEW_FAILED" });
});
