import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function dischargePdf(): Promise<Uint8Array> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  return new Uint8Array(
    await readFile(
      resolve(root, process.env.SVBOX_DIR ?? "data/svbox", "Befunde/Entlassungsbefund.pdf"),
    ),
  );
}
