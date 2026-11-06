import { SozdokDirectoryError, sozdokFiles } from "../../../src/loaders/sozdok/directory.ts";

/** Only absent local corpus data skips tests; malformed XML and other I/O errors still fail. */
export async function hasSozdokCorpus(): Promise<boolean> {
  try {
    await sozdokFiles();
    return true;
  } catch (error) {
    if (!(error instanceof SozdokDirectoryError)) throw error;
    process.stderr.write(`Skipping real SozDok corpus tests. ${error.message}\n`);
    return false;
  }
}
