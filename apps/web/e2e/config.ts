import { z } from "zod";

export const E2E_PORT = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65534)
  .default(3000)
  .parse(process.env.LOTSE_E2E_PORT ?? process.env.PW_TEST_PORT);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_HEALTH_PORT = E2E_PORT + 1;
export const E2E_HEALTH_URL = `http://localhost:${E2E_HEALTH_PORT}/api/health`;
/** The Mac workspace web view's user agent; the chat is served only to it. */
export const E2E_APP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) SVKILotseMac/1";
