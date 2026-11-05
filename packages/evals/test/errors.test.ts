import { APICallError } from "ai";
import { expect, test } from "vitest";
import { EvaluationProviderError, providerRequest, TransportError } from "../src/errors.ts";

test("provider failures expose only safe categories and retry transient transport failures", async () => {
  const failure = (statusCode: number) =>
    new APICallError({
      message: "private provider message",
      url: "https://example.org",
      requestBodyValues: { text: "private request" },
      statusCode,
      responseBody: "private provider response",
    });
  await expect(
    providerRequest(async () => {
      throw failure(503);
    }),
  ).rejects.toBeInstanceOf(TransportError);
  await expect(
    providerRequest(async () => {
      throw failure(401);
    }),
  ).rejects.toMatchObject({ code: "authentication" });
  try {
    await providerRequest(async () => {
      throw failure(400);
    });
  } catch (error) {
    expect(error).toBeInstanceOf(EvaluationProviderError);
    expect(String(error)).not.toContain("private");
    expect(JSON.stringify(error)).not.toContain("private");
  }
});
