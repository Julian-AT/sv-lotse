import { checkHealth } from "@/server/health.ts";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export function GET() {
  return checkHealth();
}
