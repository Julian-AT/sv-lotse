import { expect, test } from "vitest";
import {
  acceptedVisionPoint,
  ResolveRequestSchema,
  resolveTarget,
} from "../../src/resolve/index.ts";

test("FR-C3 uncertain or missing vision targets do not become exact points", () => {
  expect(
    acceptedVisionPoint({ found: true, x: 0.3, y: 0.4, confidence: 0.79 }, 2).point,
  ).toBeNull();
  expect(acceptedVisionPoint({ found: false, x: 0.3, y: 0.4, confidence: 1 }, 2).point).toBeNull();
  expect(acceptedVisionPoint({ found: true, x: 0.3, y: 0.4, confidence: 0.95 }, 2).point).toEqual({
    kind: "point",
    x: 0.3,
    y: 0.4,
    confidence: 0.95,
    screenIndex: 2,
  });
});
test("FR-C3 resolution rejects URLs and invalid images before making a provider call", async () => {
  const target = { kind: "text", quote: "Visible label" };
  expect(
    ResolveRequestSchema.safeParse({ target, image: "https://example.com/image", screenIndex: 0 })
      .success,
  ).toBe(false);
  await expect(
    resolveTarget({ target, image: "AAAA", screenIndex: 0 }, new AbortController().signal),
  ).rejects.toMatchObject({ code: "INVALID_RESOLVE" });
});
