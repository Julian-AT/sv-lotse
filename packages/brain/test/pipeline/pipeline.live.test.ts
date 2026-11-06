import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { cases, turns, users } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { parseBrainConfig } from "../../src/config/index.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { searchKnowledge } from "../../src/retrieval/index.ts";
import { chunks, identity, loadEnvironment, turn, userMessage } from "../runtime/helpers.ts";

loadEnvironment();
it("FR-G4 indexes real passages and confirms a goal before a real guarded, cited administrative answer", async () => {
  if (process.env.RUN_LIVE !== "1") throw new Error("RUN_LIVE is required");
  const database = createDatabase();
  let userId: string | undefined;
  try {
    const config = parseBrainConfig();
    const passages = await searchKnowledge(database.db, config, {
      query: "Pflegegeld Antrag Voraussetzungen",
      filters: {},
      k: 8,
    });
    expect(passages.length).toBeGreaterThan(0);
    expect(
      passages.every((passage) => passage.text.length > 0 && !passage.url.includes("example")),
    ).toBe(true);
    const legal = await searchKnowledge(database.db, config, {
      query: "Pflegebedarf BPGG",
      filters: {},
      k: 20,
    });
    expect(
      legal.some(
        (passage) => passage.url.startsWith("sozdok://") && passage.text.includes("SozDok"),
      ),
    ).toBe(true);
    const session = await identity(database.db, "L1");
    userId = session.userId;
    const message = userMessage();
    message.parts[0] = {
      type: "text",
      text: "Ich möchte anhand offizieller Quellen erfahren, bei welcher Stelle ich einen Antrag auf Pflegegeld einbringen kann.",
    };
    const first = await handleTurn(turn, message, session, { db: database.db, config });
    const caseId = first.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Missing case id");
    const proposed = await chunks(first);
    expect(proposed.some((part) => part.type === "error")).toBe(false);
    expect(proposed.some((part) => part.type === "message-metadata")).toBe(true);
    const [unconfirmed] = await database.db.select().from(cases).where(eq(cases.id, caseId));
    expect(unconfirmed?.confirmedGoal).toBe("");
    const response = await handleTurn(
      { ...turn, caseId },
      {
        id: randomUUID(),
        role: "user",
        parts: [
          { type: "text", text: "Ja, genau, das ist mein Ziel. Bitte nennen Sie die Quelle." },
        ],
      },
      session,
      { db: database.db, config },
    );
    const output = await chunks(response);
    expect(output.some((part) => part.type === "error")).toBe(false);
    expect(output.some((part) => part.type === "data-case-event")).toBe(true);
    const speech = output.filter((part) => part.type === "data-speech-segment");
    expect(speech.length).toBeGreaterThan(0);
    expect(
      speech.some(
        (part) =>
          part.type === "data-speech-segment" &&
          typeof part.data === "object" &&
          part.data !== null &&
          "citations" in part.data &&
          Array.isArray(part.data.citations) &&
          part.data.citations.length > 0,
      ),
    ).toBe(true);
    const completed = await database.db
      .select()
      .from(turns)
      .where(and(eq(turns.caseId, caseId), eq(turns.status, "completed")));
    expect(completed).toHaveLength(2);
    expect(completed.every((item) => item.segments.length > 0)).toBe(true);
  } finally {
    if (userId) await database.db.delete(users).where(eq(users.id, userId));
    await database.close();
  }
}, 180000);
