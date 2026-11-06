import { expect, it } from "vitest";
import { awaitPreviousTurn, CONTINUATION_WAIT } from "../../src/conversation/continuation-wait.ts";
import { TurnError } from "../../src/conversation/errors.ts";

const noWait = async (): Promise<void> => {};

it("a continuation waits for the turn that is still saving, then succeeds", async () => {
  let calls = 0;
  const result = await awaitPreviousTurn(
    true,
    async () => {
      calls++;
      if (calls === 1) throw new TurnError("TURN_IN_PROGRESS", 409);
      if (calls === 2) throw new TurnError("CONTINUATION_REJECTED", 403);
      return "ok";
    },
    noWait,
  );
  expect(result).toBe("ok");
  expect(calls).toBe(3);
});

it("a rejected user message is not retried, and retries are bounded", async () => {
  let calls = 0;
  const rejected = () => {
    calls++;
    return Promise.reject(new TurnError("CONTINUATION_REJECTED", 403));
  };
  await expect(awaitPreviousTurn(false, rejected, noWait)).rejects.toThrow("CONTINUATION_REJECTED");
  expect(calls).toBe(1);
  calls = 0;
  await expect(awaitPreviousTurn(true, rejected, noWait)).rejects.toThrow("CONTINUATION_REJECTED");
  expect(calls).toBe(CONTINUATION_WAIT.attempts);
  calls = 0;
  const invalid = () => {
    calls++;
    return Promise.reject(new TurnError("INVALID_TURN", 400));
  };
  await expect(awaitPreviousTurn(true, invalid, noWait)).rejects.toThrow("INVALID_TURN");
  expect(calls).toBe(1);
});
