import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const directoryEnvironment = z.object({ SVBOX_DIR: z.string().trim().min(1).optional() });

export function sozdokDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const config = directoryEnvironment.parse(environment);
  return resolve(repositoryRoot, config.SVBOX_DIR ?? "data/svbox", "Rechtstexte");
}

export class SozdokDirectoryError extends Error {
  constructor(directory: string) {
    super(
      `SozDok XML directory is missing or contains no XML files: ${directory}. ` +
        "Rechtstexte is not tracked in git. Place the original XML files in " +
        "<repository>/data/svbox/Rechtstexte/, or set SVBOX_DIR to the SV-Box parent directory " +
        "containing Rechtstexte (absolute or relative to the repository root). " +
        "For a copied subset, sozdok:load also accepts --directory <xml-folder>.",
    );
    this.name = "SozdokDirectoryError";
  }
}

/** Resolve explicit subset paths from the repository too, never the caller's working directory. */
export async function sozdokFiles(directory = sozdokDirectory()): Promise<string[]> {
  const absoluteDirectory = resolve(repositoryRoot, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(
    (cause: unknown) => {
      const error = z.object({ code: z.string() }).safeParse(cause);
      if (error.success && ["ENOENT", "ENOTDIR"].includes(error.data.code)) {
        throw new SozdokDirectoryError(absoluteDirectory);
      }
      throw cause;
    },
  );
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".xml"))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((entry) => join(absoluteDirectory, entry.name));
  if (files.length === 0) throw new SozdokDirectoryError(absoluteDirectory);
  return files;
}
