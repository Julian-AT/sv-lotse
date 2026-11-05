import { APICallError } from "ai";

/** Adapters may throw this only for transient connection, timeout, rate-limit or server failures. */
export class TransportError extends Error {
  constructor() {
    super("Evaluation transport failed");
    this.name = "TransportError";
  }
}
export class EvaluationProviderError extends Error {
  readonly code: "authentication" | "provider";
  constructor(code: "authentication" | "provider") {
    super(`Evaluation provider failed (${code})`);
    this.name = "EvaluationProviderError";
    this.code = code;
  }
}

/** Never attach the original error: provider messages and bodies can contain request data. */
export async function providerRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (APICallError.isInstance(error)) {
      const status = error.statusCode;
      if (
        error.isRetryable &&
        (status === undefined || status === 408 || status === 429 || status >= 500)
      )
        throw new TransportError();
      if (status === 401 || status === 403) throw new EvaluationProviderError("authentication");
    }
    throw new EvaluationProviderError("provider");
  }
}
