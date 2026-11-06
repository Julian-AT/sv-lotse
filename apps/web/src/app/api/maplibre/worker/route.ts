import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
const directory = join(process.cwd(), "node_modules/maplibre-gl");

/** Serve the installed map worker from the same origin in both dev and standalone builds. */
export async function GET(): Promise<Response> {
  try {
    const bytes = await readFile(join(directory, "dist/maplibre-gl-worker.mjs"));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "text/javascript",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
