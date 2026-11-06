export class TurnError extends Error {
  constructor(
    readonly code:
      | "INVALID_TURN"
      | "CASE_ACCESS_DENIED"
      | "CONTINUATION_REJECTED"
      | "TURN_SUPERSEDED"
      | "TURN_IN_PROGRESS",
    readonly status: number,
  ) {
    super(code);
    this.name = "TurnError";
  }
}
export function rejectContinuation(): never {
  throw new TurnError("CONTINUATION_REJECTED", 403);
}
