import { expect, it } from "vitest";
import { turnStreamError } from "../../src/conversation/errors.ts";

it("turn failures expose only fixed categories, never provider messages or arbitrary names", () => {
  const error = new Error("private provider request and document text");
  error.name = "AI_APICallError";
  expect(turnStreamError(error)).toBe("TURN_FAILED_PROVIDER");
  error.name = "private-content-in-name";
  expect(turnStreamError(error)).toBe("TURN_FAILED");
  expect(turnStreamError(new TypeError("private document text"))).toBe("TURN_FAILED_TYPE");
  expect(turnStreamError({ message: "private" })).toBe("TURN_FAILED");
});
