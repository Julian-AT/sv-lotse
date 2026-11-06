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
