import { createHash, timingSafeEqual } from "node:crypto";

export function isCronAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const received = request.headers.get("authorization");
  if (!received) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(`Bearer ${secret}`));
}
