import type { DatabaseClient } from "@lotse/db";
import { messages } from "@lotse/db/schema";
import { getToolName, isToolUIPart } from "ai";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

const ToolOutput = z.object({
  type: z.string(),
  state: z.literal("output-available"),
  input: z.unknown(),
  output: z.unknown(),
});

/** Only persisted server results supply candidate metadata and resolved recipients. */
export async function formHistory(
  db: DatabaseClient,
  caseId: string,
): Promise<z.infer<typeof ToolOutput>[]> {
  const rows = await db
    .select({ message: messages.uiMessage })
    .from(messages)
    .where(eq(messages.caseId, caseId))
    .orderBy(desc(messages.position));
  return rows.flatMap(({ message }) =>
    [...message.parts].reverse().flatMap((part) => {
      if (!isToolUIPart(part) || part.state !== "output-available") return [];
      const parsed = ToolOutput.safeParse({ ...part, type: `tool-${getToolName(part)}` });
      return parsed.success ? [parsed.data] : [];
    }),
  );
}
