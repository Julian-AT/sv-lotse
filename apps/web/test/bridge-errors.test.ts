// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { installBridge, reportBridgeError } from "../src/bridge/index.ts";
import { openingResource } from "../src/conversation/use-conversation.ts";

afterEach(() => vi.restoreAllMocks());

test("a speech stop does not abort the turn while a page is opening", () => {
  expect(openingResource(new Map([["call-1", "ui.openResource"]]))).toBe(true);
  expect(openingResource(new Map([["call-2", "context.readScreen"]]))).toBe(false);
  expect(openingResource(new Map())).toBe(false);
});

test("bridge failures are logged once with their reason", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  reportBridgeError("postNative SpeechSegment", new Error("unsupported_message"));
  reportBridgeError("postNative SpeechSegment", new Error("unsupported_message"));
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]?.[0]).toContain("unsupported_message");
});

test("an invalid native message is rejected and logged instead of failing silently", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const receiver = vi.fn();
  const uninstall = installBridge(receiver);
  await expect(
    window.__lotse?.receive({
      v: "1.0.0",
      id: "x",
      type: "ActionResult",
      payload: { actionId: "a" },
    }),
  ).rejects.toThrow();
  expect(receiver).not.toHaveBeenCalled();
  expect(log.mock.calls[0]?.[0]).toContain("native message ActionResult");
  uninstall();
});
