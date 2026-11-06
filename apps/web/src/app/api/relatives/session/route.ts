import { getRelativeSessionResponse, updateRelativeSessionResponse } from "@/server/relatives.ts";

export const runtime = "nodejs";

export const GET = getRelativeSessionResponse;
export const POST = updateRelativeSessionResponse;
