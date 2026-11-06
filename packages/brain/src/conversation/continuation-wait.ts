import { TurnError } from "./errors.ts";

export const CONTINUATION_WAIT = { attempts: 12, delayMs: 300 } as const;

/**
 * A client tool can finish (a form viewer opens in milliseconds) while the turn that requested it
 * is still saving its assistant message. Its continuation then meets a running turn or the not yet
 * saved message; it waits for that turn instead of failing. Each attempt re-validates from scratch.
 */
export async function awaitPreviousTurn<T>(
  continuation: boolean,
  attempt: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable =
        error instanceof TurnError &&
        (error.code === "TURN_IN_PROGRESS" ||
          (continuation && error.code === "CONTINUATION_REJECTED"));
      if (!retryable || tries >= CONTINUATION_WAIT.attempts) throw error;
      await wait(CONTINUATION_WAIT.delayMs);
    }
  }
}
