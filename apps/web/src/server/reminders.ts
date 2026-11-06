import {
  createDeadlineService,
  DeadlineError,
  exportRemindersCalendar,
} from "@lotse/brain/deadlines";
import { z } from "zod";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";

/** Download only: importing into a calendar remains a separate user-controlled action. */
async function remindersResponse(request: Request, calendar: boolean): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const identity = await requireSession(request);
    const query = z
      .strictObject({ caseId: z.uuid() })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success)
      return Response.json({ error: "INVALID_REMINDER_QUERY" }, { status: 400, headers });
    const reminders = await createDeadlineService(getDatabase().db, identity.userId).list(
      query.data.caseId,
    );
    if (!calendar) return Response.json({ reminders }, { headers });
    return new Response(exportRemindersCalendar(reminders, new Date()), {
      headers: {
        ...headers,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lotse-reminders.ics"',
      },
    });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof DeadlineError && error.code === "access_denied")
      return Response.json({ error: "CASE_ACCESS_DENIED" }, { status: 403, headers });
    return Response.json({ error: "REMINDER_EXPORT_FAILED" }, { status: 500, headers });
  }
}

export function remindersCalendarResponse(request: Request): Promise<Response> {
  return remindersResponse(request, true);
}
export function remindersListResponse(request: Request): Promise<Response> {
  return remindersResponse(request, false);
}
