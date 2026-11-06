import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { createDatabase } from "@lotse/db";
import { z } from "zod";
import { jsonFile, normalized, ROOT, SETS, splitDataset } from "./data.ts";

const sourceManifest = z.array(z.object({ uri: z.url(), passages: z.array(z.string()) }));

export async function auditE3Index(): Promise<unknown> {
  const manifest = sourceManifest.parse(await jsonFile(`${SETS}/e3/sources.json`));
  const { cases } = await splitDataset("E3", "questions.json");
  const database = createDatabase();
  try {
    const [corpus] = await database.sql`SELECT count(*)::int AS chunks,
      count(DISTINCT source_id)::int AS sources FROM kb_chunk`;
    const rows = await database.sql<
      {
        url: string;
        text: string;
        active: boolean;
        model: string | null;
      }[]
    >`SELECT s.url, c.text,
      (s.valid_from IS NULL OR s.valid_from <= now()) AND
      (s.valid_to IS NULL OR s.valid_to > now()) AND
      (c.valid_from IS NULL OR c.valid_from <= now()) AND
      (c.valid_to IS NULL OR c.valid_to > now()) AS active,
      c.metadata->'embedding'->>'model' AS model
      FROM source s JOIN kb_chunk c ON c.source_id=s.id`;
    const sources = manifest.map((source) => {
      const chunks = rows.filter(({ url }) => url === source.uri);
      const intact = (passage: string): boolean =>
        chunks.some((chunk) => normalized(chunk.text).includes(normalized(passage)));
      return {
        url: source.uri,
        chunks: chunks.length,
        activeChunks: chunks.filter(({ active }) => active).length,
        passages: source.passages.length,
        intactPassages: source.passages.filter(intact).length,
        missingPassageIndexes: source.passages.flatMap((passage, index) =>
          intact(passage) ? [] : [index],
        ),
      };
    });
    const covered = cases.filter((item) =>
      rows.some(
        (chunk) =>
          chunk.active &&
          chunk.url === item.source?.uri &&
          normalized(chunk.text).includes(normalized(item.source.passage)),
      ),
    );
    return {
      generatedAt: new Date().toISOString(),
      corpus,
      embeddingModels: [...new Set(rows.map(({ model }) => model))],
      goldSources: sources.length,
      indexedGoldSources: sources.filter(({ chunks }) => chunks > 0).length,
      goldPassages: sources.reduce((sum, source) => sum + source.passages, 0),
      intactPassages: sources.reduce((sum, source) => sum + source.intactPassages, 0),
      questions: cases.length,
      coveredQuestions: covered.length,
      uncoveredQuestionIds: cases.filter((item) => !covered.includes(item)).map(({ id }) => id),
      sources,
    };
  } finally {
    await database.close();
  }
}

async function main(): Promise<void> {
  const environment = resolve(ROOT, ".env.local");
  if (existsSync(environment)) loadEnvFile(environment);
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const report = `${JSON.stringify(await auditE3Index(), null, 2)}\n`;
  if (values.out) await writeFile(resolve(ROOT, values.out), report);
  else process.stdout.write(report);
}

main().catch(() => {
  process.stderr.write('{"event":"e3_audit_failed","code":"configuration_or_service_error"}\n');
  process.exitCode = 1;
});
