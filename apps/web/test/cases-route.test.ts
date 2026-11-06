import { beforeEach, expect, test, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  caseFile: vi.fn(),
  dashboard: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("../src/server/case-file.ts", () => ({
  casesResponse: handlers.caseFile,
  dashboardCasesResponse: handlers.dashboard,
}));
vi.mock("../src/server/workspace.ts", () => ({ casesResponse: handlers.workspace }));

import { GET, POST, runtime } from "../src/app/api/cases/route.ts";

beforeEach(() => {
  vi.resetAllMocks();
});

test("GET preserves the case-file list by default", async () => {
  const request = new Request("https://lotse.test/api/cases");
  const response = Response.json([{ id: "case" }]);
  handlers.caseFile.mockResolvedValue(response);

  expect(await GET(request)).toBe(response);
  expect(handlers.caseFile).toHaveBeenCalledWith(request);
  expect(handlers.workspace).not.toHaveBeenCalled();
  expect(runtime).toBe("nodejs");
});

test("GET supports the workspace summary response when requested", async () => {
  const request = new Request("https://lotse.test/api/cases?view=workspace");
  const response = Response.json({ cases: [] });
  handlers.workspace.mockResolvedValue(response);

  expect(await GET(request)).toBe(response);
  expect(handlers.workspace).toHaveBeenCalledWith(request);
  expect(handlers.caseFile).not.toHaveBeenCalled();
});

test("POST delegates case creation to the workspace service", async () => {
  const request = new Request("https://lotse.test/api/cases", { method: "POST" });
  const response = Response.json({ case: { id: "case" } });
  handlers.workspace.mockResolvedValue(response);

  expect(await POST(request)).toBe(response);
  expect(handlers.workspace).toHaveBeenCalledWith(request);
  expect(handlers.caseFile).not.toHaveBeenCalled();
});

test("GET supports the native dashboard without changing existing list contracts", async () => {
  const request = new Request("https://lotse.test/api/cases?view=dashboard");
  const response = Response.json({ cases: [] });
  handlers.dashboard.mockResolvedValue(response);
  expect(await GET(request)).toBe(response);
  expect(handlers.dashboard).toHaveBeenCalledWith(request);
  expect(handlers.caseFile).not.toHaveBeenCalled();
  expect(handlers.workspace).not.toHaveBeenCalled();
});
