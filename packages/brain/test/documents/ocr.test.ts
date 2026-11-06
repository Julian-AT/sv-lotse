import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mocks.generate,
}));
vi.mock("../../src/models/index.ts", () => ({ modelFor: () => ({}) }));

import { recognizeImage } from "../../src/documents/pages.ts";

const line = {
  text: "Ausstellungsdatum: 06.11.2026",
  bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.03 },
};
beforeEach(() => vi.resetAllMocks());

test("FR-D2 clips OCR boxes crossing the page boundary without losing the source text", async () => {
  mocks.generate.mockResolvedValue({
    output: { lines: [{ ...line, bbox: { x: 0.8, y: 0.99, width: 0.3, height: 0.03 } }] },
  });
  const result = await recognizeImage(new Uint8Array([1]), "image/png");
  expect(result[0]?.text).toBe(line.text);
  expect(result[0]?.bbox.width).toBeCloseTo(0.2);
  expect(result[0]?.bbox.height).toBeCloseTo(0.01);
});
test("FR-D2 retries invalid OCR geometry and returns only validated positioned lines", async () => {
  mocks.generate
    .mockResolvedValueOnce({ output: { lines: [{ ...line, bbox: { ...line.bbox, y: 1 } }] } })
    .mockResolvedValueOnce({ output: { lines: [line] } });
  expect(await recognizeImage(new Uint8Array([1]), "image/png")).toEqual([line]);
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
test("FR-D2 fails closed after bounded invalid geometry and does not leak provider errors", async () => {
  mocks.generate.mockResolvedValue({
    output: { lines: [{ ...line, bbox: { ...line.bbox, height: 0 } }] },
  });
  await expect(recognizeImage(new Uint8Array([1]), "image/png")).rejects.toMatchObject({
    code: "ocr_failed",
  });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  mocks.generate.mockRejectedValue(new Error("private provider content"));
  await expect(recognizeImage(new Uint8Array([1]), "image/png")).rejects.toMatchObject({
    message: "ocr_failed",
  });
});
