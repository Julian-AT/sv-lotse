import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const runtime = "nodejs";

async function assetDirectory(): Promise<string> {
  // Resolve at the Node boundary. Webpack's createRequire transform returns module
  // IDs rather than filesystem paths; PDF.js assets must come from the installed package.
  const nodeModule = await import(/* webpackIgnore: true */ "node:module");
  return dirname(
    nodeModule
      .createRequire(join(process.cwd(), "package.json"))
      .resolve("pdfjs-dist/package.json"),
  );
}

const AssetSchema = z
  .tuple([
    z.enum(["build", "cmaps", "standard_fonts", "wasm"]),
    z.string().regex(/^[a-zA-Z0-9_.-]+\.(mjs|bcmap|pfb|ttf|wasm)$/),
  ])
  .refine(
    ([group, file]) =>
      group !== "build" || ["pdf.worker.min.mjs", "pdf.renderer.min.mjs"].includes(file),
  );

/** Serve the exact installed version locally, including CMaps/fonts for official PDFs. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string[] }> },
): Promise<Response> {
  const parsed = AssetSchema.safeParse((await context.params).asset);
  if (!parsed.success) return new Response(null, { status: 404 });
  try {
    const [group, file] = parsed.data;
    const bytes = await readFile(join(await assetDirectory(), group, file));
    const contentType = file.endsWith("mjs")
      ? "text/javascript"
      : file.endsWith("wasm")
        ? "application/wasm"
        : "application/octet-stream";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
