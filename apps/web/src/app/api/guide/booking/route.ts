import { bookingGuideResponse } from "@/server/booking-guide.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return bookingGuideResponse(request);
}
