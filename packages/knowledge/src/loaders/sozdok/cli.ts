import { parseArgs } from "node:util";
import { createDatabase } from "@lotse/db";
import { SozdokDirectoryError, sozdokFiles } from "./directory.ts";
import { loadSozdokEnvironment } from "./environment.ts";
import { loadSozdok } from "./load.ts";
import { SozdokParseError } from "./parse.ts";

async function main(): Promise<void> {
  loadSozdokEnvironment();
  const { values } = parseArgs({
    options: { on: { type: "string" }, directory: { type: "string" } },
    allowPositionals: false,
  });
  await sozdokFiles(values.directory);
  const database = createDatabase();
  try {
    const result = await loadSozdok(database, values);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  // Driver errors may contain connection details or document text.
  process.stderr.write(
    error instanceof SozdokParseError || error instanceof SozdokDirectoryError
      ? `${error.message}\n`
      : "SozDok load failed; check arguments, XML files and database availability.\n",
  );
  process.exitCode = 1;
});
