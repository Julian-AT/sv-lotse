import { parseArgs } from "node:util";
import { createDatabase } from "@lotse/db";
import { z } from "zod";
import { SozdokDirectoryError, sozdokFiles } from "../loaders/sozdok/directory.ts";
import { loadEnvironment } from "./environment.ts";
import { ingestPilot } from "./pilot.ts";

async function main(): Promise<void> {
  loadEnvironment();
  const { values } = parseArgs({
    options: { on: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  });
  const on = z.iso.date().parse(values.on ?? new Date().toISOString().slice(0, 10));
  if (!values["dry-run"]) await sozdokFiles();
  const database = values["dry-run"] ? null : createDatabase();
  try {
    const result = await ingestPilot(database, on);
    process.stdout.write(`${JSON.stringify({ event: "pilot_ingested", ...result })}\n`);
    if (result.failed) process.exitCode = 1;
  } finally {
    await database?.close();
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof SozdokDirectoryError
      ? `${error.message}\n`
      : '{"event":"pilot_ingestion_failed","code":"configuration_or_service_error"}\n',
  );
  process.exitCode = 1;
});
