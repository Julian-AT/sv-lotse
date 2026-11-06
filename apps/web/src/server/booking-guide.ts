import { TurnError } from "@lotse/brain";
import { AutonomyError, bookingGuideConfiguration } from "@lotse/brain/autonomy";
import { z } from "zod";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";

export async function bookingGuideResponse(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const identity = await requireSession(request);
    const query = z
      .strictObject({ caseId: z.uuid() })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success)
      return Response.json({ error: "INVALID_GUIDE_QUERY" }, { status: 400, headers });
    return Response.json(
      await bookingGuideConfiguration(getDatabase().db, query.data.caseId, identity),
      { headers },
    );
  } catch (error) {
    if (error instanceof SessionUnauthorized || error instanceof TurnError)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof AutonomyError)
      return Response.json({ error: error.code }, { status: 400, headers });
    return Response.json({ error: "BOOKING_GUIDE_FAILED" }, { status: 500, headers });
  }
}
