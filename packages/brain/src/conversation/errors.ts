import { ProcessError } from "../engine/schema.ts";

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

/** Fixed categories only: provider exception messages can contain document text or secrets. */
export function turnStreamError(error: unknown): string {
  if (error instanceof ProcessError) return `PROCESS_${error.code}`;
  if (!(error instanceof Error)) return "TURN_FAILED";
  switch (error.name) {
    case "AI_APICallError":
      return "TURN_FAILED_PROVIDER";
    case "AI_TypeValidationError":
      return "TURN_FAILED_VALIDATION";
    case "AI_InvalidPromptError":
      return "TURN_FAILED_PROMPT";
    case "AI_MissingToolResultsError":
      return "TURN_FAILED_TOOL_RESULTS";
    case "TypeError":
      return "TURN_FAILED_TYPE";
    case "ZodError":
      return "TURN_FAILED_SCHEMA";
    case "TurnError":
      return "TURN_FAILED_AUTHORITY";
    case "PipelineError":
      return "TURN_FAILED_PIPELINE";
    default:
      return "TURN_FAILED";
  }
}
