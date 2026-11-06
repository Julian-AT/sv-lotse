export class RetrievalError extends Error {
  readonly code: "KNOWLEDGE_SEARCH_FAILED" | "TURN_ABORTED";
  readonly databaseCode: string | undefined;
  constructor(code: RetrievalError["code"], databaseCode?: string) {
    super(code);
    this.name = "RetrievalError";
    this.code = code;
    this.databaseCode = databaseCode;
  }
}
