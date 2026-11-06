import { z } from "zod";
export const browserSessionSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  caseShared: z.boolean().default(false),
  paused: z.boolean().default(false),
  state: z.enum(["invited", "pending", "approved", "ended"]),
  expiresAt: z.string(),
});
export type BrowserRelativeSession = z.infer<typeof browserSessionSchema>;
export const inviteResponseSchema = z.object({
  id: z.uuid(),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.string(),
});
export const tokenResponseSchema = z.object({
  token: z.string().min(1),
  url: z.url({ protocol: /^wss?$/ }),
  role: z.enum(["subject", "helper"]),
  peerIdentity: z.string().min(1),
  expiresAt: z.string(),
});
export const casesResponseSchema = z.object({
  cases: z.array(z.object({ id: z.uuid(), subjectId: z.uuid(), confirmedGoal: z.string() })),
});
export async function relativeRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error("RELATIVES_REQUEST_FAILED");
  return schema.parse(await response.json());
}
