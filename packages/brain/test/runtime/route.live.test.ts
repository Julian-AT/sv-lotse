import { messages, turns } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { POST } from "../../../../apps/web/src/app/api/turn/route.ts";
import { getDatabase } from "../../../../apps/web/src/server/resources.ts";
import { requireSession } from "../../../../apps/web/src/server/session.ts";
import { sessionCookieName, signCookie } from "../../../../apps/web/src/server/session-cookie.ts";
import { parseBrainConfig } from "../../src/config/index.ts";
import { closeBrain } from "../../src/conversation/index.ts";
import { chunks, identity, isolatedDatabase, turn, userMessage } from "./helpers.ts";

it("AC7 streams a real German model answer through the authenticated route and persists the turn", async () => {
  const database = await isolatedDatabase();
  process.env.DATABASE_URL = database.config.DATABASE_URL;
  try {
    const session = await identity(database.db, "L1");
    const message = userMessage();
    message.parts[0] = {
      type: "text",
      text: "Bitte antworten Sie auf Deutsch in einem kurzen Satz, dass Sie bei Verwaltungsfragen helfen.",
    };
    const request = new Request("http://localhost:3000/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...turn, message }),
    });
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is required for the live route test");
    const cookieName = sessionCookieName(
      process.env.LOTSE_WORKSPACE_URL ?? "http://localhost:3000",
      request,
    );
    request.headers.set(
      "cookie",
      `${cookieName}=${signCookie(session.sessionId, secret, Date.now())}`,
    );
    parseBrainConfig();
    expect(await requireSession(request)).toMatchObject(session);
    const crossOrigin = request.clone();
    crossOrigin.headers.set("origin", "https://untrusted.example");
    expect((await POST(crossOrigin)).status).toBe(403);
    expect((await POST(new Request(request.url, { method: "POST" }))).status).toBe(401);
    expect(
      (
        await POST(
          new Request(request.url, { method: "POST", headers: request.headers, body: "{" }),
        )
      ).status,
    ).toBe(400);
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    const caseId = response.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Missing case id");
    const parts = await chunks(response);
    expect(parts.some((part) => part.type === "error")).toBe(false);
    const answer = parts
      .flatMap((part) => (part.type === "text-delta" ? [part.delta] : []))
      .join("");
    expect(answer).toMatch(/(?:helf|unterstütz).*(?:Verwaltung|Behörd|Sozialversicherung)/i);
    const rows = await database.db
      .select()
      .from(messages)
      .where(eq(messages.caseId, caseId))
      .orderBy(messages.position);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.uiMessage.id).toBe(message.id);
    expect(
      rows[1]?.uiMessage.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    ).toBe(answer);
    const [savedTurn] = await database.db.select().from(turns).where(eq(turns.caseId, caseId));
    expect(savedTurn?.status).toBe("completed");
  } finally {
    await closeBrain();
    await getDatabase().close();
    await database.cleanup();
  }
});
