export class PipelineError extends Error {
  readonly code:
    | "CASE_NOT_FOUND"
    | "CONTEXT_BUDGET_EXCEEDED"
    | "POLICY_BUDGET_EXCEEDED"
    | "TURN_ABORTED";
  constructor(code: PipelineError["code"]) {
    super(code);
    this.name = "PipelineError";
    this.code = code;
  }
}
