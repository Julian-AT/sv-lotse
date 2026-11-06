import { expect, test } from "vitest";
import { readPointerMessage, videoPoint } from "@/features/relatives/messages.ts";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
test("FR-R3 validates pointer coordinates and rejects malformed or oversized data messages", () => {
  expect(readPointerMessage(encode({ type: "pointer", x: 0.25, y: 1 }))).toEqual({
    type: "pointer",
    x: 0.25,
    y: 1,
  });
  for (const value of [
    { type: "pointer", x: -1, y: 0 },
    { type: "pointer", x: 0, y: 2 },
    { type: "execute", x: 0, y: 0 },
    { type: "mark", x: 0, y: 0, label: "untrusted" },
  ]) {
    expect(readPointerMessage(encode(value))).toBeNull();
  }
  expect(readPointerMessage(new Uint8Array(1024))).toBeNull();
  expect(readPointerMessage(new TextEncoder().encode("invalid"))).toBeNull();
});
test("FR-R3 maps the displayed screen rather than its letterbox bars", () => {
  const box = { left: 10, top: 20, width: 200, height: 200 };
  const video = { width: 1920, height: 1080 };
  expect(videoPoint(110, 120, box, video)).toEqual({ x: 0.5, y: 0.5 });
  expect(videoPoint(110, 21, box, video)).toBeNull();
  expect(videoPoint(9, 120, box, video)).toBeNull();
  expect(videoPoint(110, 120, box, { width: 0, height: 0 })).toBeNull();
});
