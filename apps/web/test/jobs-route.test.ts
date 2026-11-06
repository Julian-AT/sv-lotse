import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), database: vi.fn(), environment: vi.fn() }));
vi.mock("@lotse/brain/jobs", async (original) => ({
  ...(await original<typeof import("@lotse/brain/jobs")>()),
  runJobs: mocks.run,
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: mocks.database }));
vi.mock("../src/server/env.ts", () => ({ getEnvironment: mocks.environment }));

import { GET, POST } from "../src/app/api/jobs/run/route.ts";
import * as worker from "../src/app/api/jobs/worker/route.ts";

const secret = "unit-cron-credential-at-least-32-characters";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.environment.mockReturnValue({ CRON_SECRET: secret });
  mocks.database.mockReturnValue({ db: {} });
  mocks.run.mockResolvedValue([]);
});

test("the actual cron route rejects unauthorized callers before opening the database", async () => {
  expect((await GET(new Request("https://lotse.test/api/jobs/run"))).status).toBe(401);
  expect(mocks.database).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
test("GET and POST await persisted jobs after bearer authentication", async () => {
  for (const handler of [GET, POST]) {
    const response = await handler(
      new Request("https://lotse.test/api/jobs/run", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ parts: [] });
  }
  expect(mocks.run).toHaveBeenCalledTimes(2);
});
test("cron failures expose a fixed error code without provider content", async () => {
  mocks.run.mockRejectedValue(new Error("private-provider-error-sentinel"));
  const response = await GET(
    new Request("https://lotse.test/api/jobs/run", {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "REQUEST_FAILED" });
});
test("PRD 7 /api/jobs/worker is protected by CRON_SECRET exactly like /api/jobs/run", async () => {
  for (const handler of [worker.GET, worker.POST]) {
    const denied = await handler(
      new Request("https://lotse.test/api/jobs/worker", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "CRON_UNAUTHORIZED" });
  }
  expect(mocks.database).not.toHaveBeenCalled();
  const response = await worker.POST(
    new Request("https://lotse.test/api/jobs/worker", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ parts: [] });
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(worker.GET).toBe(GET);
  expect(worker.maxDuration).toBe(300);
});
