import { parseBrainConfig } from "@lotse/brain/config";
import { searchKnowledge } from "@lotse/brain/retrieval";
import { createDatabase } from "@lotse/db";
import { z } from "zod";
import { BASELINE_CONFIG } from "../config.ts";
import type { RegisteredSuite } from "../runner/index.ts";
import { ndcgAtK, recallAtK } from "../stats/index.ts";
import { checkGold, normalized, splitDataset } from "./data.ts";

export function passageRanking(
  hits: readonly { id: string; url: string; text: string }[],
  uri: string,
  passage: string,
): string[] {
  return hits.map((hit) =>
    hit.url === uri && normalized(hit.text).includes(normalized(passage)) ? "gold-passage" : hit.id,
  );
}
export async function e3Suite(): Promise<{
  definition: RegisteredSuite;
  close: () => Promise<void>;
}> {
  const data = await splitDataset("E3", "questions.json");
  await checkGold(data.cases);
  const database = createDatabase();
  try {
    // Preflight fails once rather than timing out identically for every gold question.
    await database.sql`select count(*) from kb_chunk`;
  } catch {
    await database.close();
    throw new Error("retrieval_database_unavailable");
  }
  const config = parseBrainConfig();
  return {
    close: database.close,
    definition: {
      ...data,
      async execute(item, { signal }) {
        const { question } = z.object({ question: z.string() }).parse(item.input);
        if (!item.source) throw new Error("missing_provenance");
        const hits = await searchKnowledge(
          database.db,
          config,
          { query: question, filters: {}, k: BASELINE_CONFIG.retrievalK },
          signal,
        );
        const ranking = passageRanking(hits, item.source.uri, item.source.passage);
        const recall = recallAtK(ranking, ["gold-passage"], BASELINE_CONFIG.retrievalK) ?? 0;
        return {
          passed: recall === 1,
          metrics: {
            "recall@10": recall,
            "ndcg@10": ndcgAtK(ranking, { "gold-passage": 1 }, BASELINE_CONFIG.retrievalK) ?? 0,
          },
        };
      },
    },
  };
}
