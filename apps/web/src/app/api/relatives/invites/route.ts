import { createInviteResponse, listCasesResponse } from "@/server/relatives.ts";

export const runtime = "nodejs";

export const GET = listCasesResponse;
export const POST = createInviteResponse;
