import { ANALYTICS_PREFERENCE_KEY } from "./config.ts";

export function hasAnalyticsConsent(request: Request): boolean {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.split("=")[0] === ANALYTICS_PREFERENCE_KEY);
  return values.length === 1 && values[0] === `${ANALYTICS_PREFERENCE_KEY}=1`;
}
