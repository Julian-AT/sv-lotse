import { expect, test } from "vitest";
import { isCronAuthorized } from "../src/server/cron.ts";

test("cron rejects missing configuration, missing credentials and incorrect bearer secrets", () => {
  const request = (authorization?: string) =>
    new Request("http://localhost/api/jobs/run", {
      headers: authorization ? { authorization } : {},
    });
  const secret = "test-cron-credential-32-characters-long";
  expect(isCronAuthorized(request(), secret)).toBe(false);
  expect(isCronAuthorized(request("Bearer undefined"), undefined)).toBe(false);
  expect(isCronAuthorized(request(`Bearer ${secret}`), secret)).toBe(true);
  expect(isCronAuthorized(request(`Basic ${secret}`), secret)).toBe(false);
  expect(isCronAuthorized(request("Bearer wrong"), secret)).toBe(false);
});
