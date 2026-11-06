import { expect, test } from "vitest";
import { GET } from "../src/app/api/pdfjs/[...asset]/route.ts";
import { PDF_WORKER_URL } from "../src/features/viewer/config.ts";

const request = new Request(new URL(PDF_WORKER_URL, "http://localhost"));
test("FR-D4 serves the installed PDF worker as JavaScript rather than a bundled module identifier", async () => {
  const response = await GET(request, {
    params: Promise.resolve({ asset: ["build", "pdf.worker.min.mjs"] }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("javascript");
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
});

test("PDF asset serving rejects traversal and unapproved build entrypoints", async () => {
  for (const asset of [
    ["build", "../package.json"],
    ["build", "pdf.mjs"],
    ["..", "package.json"],
  ]) {
    expect((await GET(request, { params: Promise.resolve({ asset }) })).status).toBe(404);
  }
});
