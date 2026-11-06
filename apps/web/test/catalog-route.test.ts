import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), database: {} }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: mocks.database }) }));
vi.mock("@lotse/brain/catalog", async (original) => ({
  ...(await original<typeof import("@lotse/brain/catalog")>()),
  listCatalogBenefits: mocks.list,
}));

import { GET, runtime } from "../src/app/api/catalog/benefits/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const records = [{ id: "unit-record", name_de: "Testeintrag" }];
const request = (query = ""): Request =>
  new Request(`https://lotse.test/api/catalog/benefits${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "caller", sessionId: "session", kind: "anonymous" });
  mocks.list.mockResolvedValue(records);
});

test("PRD 7 catalog benefits returns the brain's records to a session", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ benefits: records });
  expect(mocks.list).toHaveBeenCalledWith(mocks.database, {});
  expect(runtime).toBe("nodejs");
});

test("PRD 7 catalog benefits passes the validated life situation, carrier and text filters", async () => {
  const response = await GET(request("?lifeSituation=%20care%20&carrier=oegk&q=Pflege"));
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(mocks.database, {
    lifeSituation: "care",
    carrier: "oegk",
    q: "Pflege",
  });
});

test("PRD 7 catalog benefits requires a session before reading the catalog", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "SESSION_REQUIRED" });
  expect(mocks.list).not.toHaveBeenCalled();
});

test("PRD 7 catalog benefits rejects unknown carriers and parameters", async () => {
  for (const query of ["?carrier=unknown", "?subjectId=caller", "?q=%20"]) {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_CATALOG_QUERY" });
  }
  expect(mocks.list).not.toHaveBeenCalled();
});

test("PRD 7 catalog benefits maps storage failures to a fixed error code", async () => {
  mocks.list.mockRejectedValue(new Error("private database detail"));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "CATALOG_UNAVAILABLE" });
});
