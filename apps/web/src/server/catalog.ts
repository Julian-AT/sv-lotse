import { benefitCatalogQuerySchema, listCatalogBenefits } from "@lotse/brain/catalog";
import { z } from "zod";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Session-only read of the loaded catalog records, filtered by the query string. */
export async function catalogBenefitsResponse(request: Request): Promise<Response> {
  try {
    await requireSession(request);
    const query = benefitCatalogQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const benefits = await listCatalogBenefits(getDatabase().db, query);
    return Response.json({ benefits }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json(
        { error: error.code },
        { status: error.status, headers: privateHeaders },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "INVALID_CATALOG_QUERY" },
        { status: 400, headers: privateHeaders },
      );
    return Response.json(
      { error: "CATALOG_UNAVAILABLE" },
      { status: 500, headers: privateHeaders },
    );
  }
}
