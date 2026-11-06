import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { cases, profiles, sessions, users } from "@lotse/db/schema";
import { simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { parseBrainConfig } from "../../src/config/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";

export function loadEnvironment() {
  const path = new URL("../../../../.env.local", import.meta.url);
  if (existsSync(path)) loadEnvFile(fileURLToPath(path));
}

export async function isolatedDatabase() {
  loadEnvironment();
  const admin = createDatabase();
  const name = `lotse_runtime_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${name}`;
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  await migrateDatabase(database);
  return {
    ...database,
    cleanup: async () => {
      await database.close();
      await admin.sql`DROP DATABASE ${admin.sql(name)}`;
      await admin.close();
    },
  };
}

export async function identity(
  db: ReturnType<typeof createDatabase>["db"],
  level: "L1" | "L2" | "L3" = "L2",
) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await db.insert(users).values({ id: userId });
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    clientKind: "web",
    expiresAt: new Date(Date.now() + 3600000),
  });
  await db.insert(profiles).values({ userId, autonomyLevel: level });
  return { userId, sessionId, kind: "anonymous" as const };
}

export const config = parseBrainConfig({ APPROVAL_HMAC_SECRET: randomUUID() });
export const turn = { inputKind: "text" as const, capsule: {}, actionResults: [] };
export const userMessage = () => ({
  id: randomUUID(),
  role: "user" as const,
  parts: [
    { type: "text" as const, text: "Bitte helfen Sie mir bei meinen Verwaltungsunterlagen." },
  ],
});

export const fillInput = {
  target: { kind: "ui", elementId: "reviewed-field" },
  value: "User statement",
  provenance: { source: { kind: "statement", quote: "User statement" } },
};

type ModelPart =
  Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export function forcedModel(toolName?: string, input: unknown = fillInput) {
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            detectedLanguage: "de",
            requestedLanguage: null,
            simpleLanguage: null,
            register: null,
            detailLevel: null,
          }),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async () => {
      const parts: ModelPart[] = [{ type: "stream-start", warnings: [] }];
      if (toolName && calls++ === 0)
        parts.push({
          type: "tool-call",
          toolCallId: randomUUID(),
          toolName,
          input: JSON.stringify(input),
        });
      else
        parts.push(
          { type: "text-start", id: "text" },
          {
            type: "text-delta",
            id: "text",
            delta: "Gern helfe ich bei Ihren Verwaltungsunterlagen.",
          },
          { type: "text-end", id: "text" },
        );
      parts.push({
        type: "finish",
        finishReason: {
          unified:
            toolName && calls === 1 && parts.some((part) => part.type === "tool-call")
              ? "tool-calls"
              : "stop",
          raw: undefined,
        },
        usage,
      });
      return {
        stream: simulateReadableStream({
          chunks: parts,
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });
}

export async function chunks(response: Response): Promise<UIMessageChunk[]> {
  const sse = await response.text();
  return sse
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as UIMessageChunk);
}

// Approval/runtime acceptance tests start after the independently tested goal-confirmation stage.
export async function confirmedRequest(
  db: ReturnType<typeof createDatabase>["db"],
  session: Awaited<ReturnType<typeof identity>>,
) {
  const context = await db.transaction((tx) => resolveContext(tx, turn, session));
  await db
    .update(cases)
    .set({ confirmedGoal: "Prepare administrative documents" })
    .where(eq(cases.id, context.caseId));
  return { ...turn, caseId: context.caseId };
}
