import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import {
  FORM_DOWNLOAD_MAX_BYTES,
  FORM_DOWNLOAD_MAX_REDIRECTS,
  FORM_DOWNLOAD_TIMEOUT_MS,
} from "../../config/index.ts";
import { FormError } from "../schema.ts";

const Allowlist = z.object({
  origins: z.array(z.object({ origin: z.url({ protocol: /^https$/ }) })),
});

export async function officialOrigins(): Promise<Set<string>> {
  const file = await readFile(
    new URL("../../../../knowledge/allowlist.yaml", import.meta.url),
    "utf8",
  );
  return new Set(Allowlist.parse(parse(file)).origins.map(({ origin }) => origin));
}

export function officialUrl(raw: string, origins: Set<string>): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FormError("origin_denied");
  }
  if (url.protocol !== "https:" || url.username || url.password || !origins.has(url.origin))
    throw new FormError("origin_denied");
  url.hash = "";
  return url;
}

export async function fetchOfficial(
  raw: string,
  origins: Set<string>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; url: string; headers: Headers }> {
  let url = officialUrl(raw, origins);
  const timeout = AbortSignal.timeout(FORM_DOWNLOAD_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    for (let redirects = 0; redirects <= FORM_DOWNLOAD_MAX_REDIRECTS; redirects++) {
      combined.throwIfAborted();
      const response = await fetch(url, {
        redirect: "manual",
        credentials: "omit",
        signal: combined,
        headers: { Accept: "application/pdf, text/html;q=0.5" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new FormError("download_failed");
        url = officialUrl(new URL(location, url).href, origins);
        continue;
      }
      if (
        !response.ok ||
        Number(response.headers.get("content-length")) > FORM_DOWNLOAD_MAX_BYTES
      ) {
        await response.body?.cancel();
        throw new FormError("download_failed");
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (!response.body) throw new FormError("download_failed");
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > FORM_DOWNLOAD_MAX_BYTES) throw new FormError("download_failed");
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks), url: url.href, headers: response.headers };
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof FormError) throw error;
    throw new FormError("download_failed");
  }
  throw new FormError("download_failed");
}
