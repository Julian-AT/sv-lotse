import { remindersCalendarResponse } from "@/server/reminders.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return remindersCalendarResponse(request);
}
