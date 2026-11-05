import type { NextRequest } from "next/server";
import { sessionResponse } from "../../../server/session.ts";

export const runtime = "nodejs";
export function POST(request: NextRequest) {
  return sessionResponse(request);
}
export function DELETE(request: NextRequest) {
  return sessionResponse(request, true);
}
