export type I18nErrorCode = "INVALID_MESSAGE" | "INVALID_PARAMETER" | "MISSING_PROVIDER";

export class I18nError extends Error {
  constructor(readonly code: I18nErrorCode) {
    super(code);
    this.name = "I18nError";
  }
}
