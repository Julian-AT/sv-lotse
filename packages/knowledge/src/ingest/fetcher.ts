import { setTimeout as delay } from "node:timers/promises";
import pLimit from "p-limit";
import robotsParser from "robots-parser";
import { z } from "zod";

export const USER_AGENT =
  "SV-KI-Lotse/1.0 (public Austrian social-insurance knowledge indexing; low-rate crawler)";
const optionsSchema = z.object({
  delayMs: z.number().nonnegative().default(1000),
  timeoutMs: z.number().positive().default(20000),
  maxBytes: z
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  maxRedirects: z.number().int().nonnegative().default(5),
});
const validatorsSchema = z.object({
  etag: z.string().optional(),
  last_modified: z.string().optional(),
  url: z.url().optional(),
});
export type Validators = z.infer<typeof validatorsSchema>;
export class FetchError extends Error {
  readonly code:
    | "origin_denied"
    | "robots_denied"
    | "robots_unavailable"
    | "size_limit"
    | "timeout"
    | "http_error"
    | "redirect_limit"
    | "content_type";
  constructor(code: FetchError["code"]) {
    super(`Ingestion fetch failed: ${code}`);
    this.code = code;
  }
}
export type FetchResult =
  | { status: "fetched"; url: string; html: string; validators: Validators; retrieved_at: string }
  | { status: "not_modified"; url: string }
  | { status: "not_supported"; url: string; reason: "pdf_text_extraction_unavailable" };
type Robots = ReturnType<typeof robotsParser>;

export class IngestionFetcher {
  private readonly origins: Set<string>;
  private readonly options: z.infer<typeof optionsSchema>;
  private readonly queues = new Map<string, ReturnType<typeof pLimit>>();
  private readonly completed = new Map<string, number>();
  private readonly robots = new Map<string, Promise<Robots>>();
  private readonly crawlDelays = new Map<string, number>();

  constructor(origins: string[], options: z.input<typeof optionsSchema> = {}) {
    this.origins = new Set(origins.map((origin) => new URL(origin).origin));
    this.options = optionsSchema.parse(options);
  }

  private checked(value: string): URL {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !this.origins.has(url.origin)
    ) {
      throw new FetchError("origin_denied");
    }
    url.hash = "";
    return url;
  }

  // Each request, including robots and redirect hops, owns only its target-origin queue.
  // This avoids holding one origin's lock while waiting on another origin's robots.
  private async request(url: URL, headers: Record<string, string>) {
    let queue = this.queues.get(url.origin);
    if (!queue) {
      queue = pLimit(1);
      this.queues.set(url.origin, queue);
    }
    return queue(async () => {
      const interval = Math.max(this.options.delayMs, this.crawlDelays.get(url.origin) ?? 0);
      await delay(Math.max(0, (this.completed.get(url.origin) ?? 0) + interval - Date.now()));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(url, {
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT, ...headers },
          signal: controller.signal,
        });
        const chunks: Uint8Array[] = [];
        let length = 0;
        const declared = Number(response.headers.get("content-length"));
        if (declared > this.options.maxBytes) throw new FetchError("size_limit");
        // Redirect bodies are irrelevant, and must never cause a follow-up fetch.
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
        } else if (response.body) {
          for await (const chunk of response.body) {
            length += chunk.byteLength;
            if (length > this.options.maxBytes) throw new FetchError("size_limit");
            chunks.push(chunk);
          }
        }
        return { status: response.status, headers: response.headers, body: Buffer.concat(chunks) };
      } catch (error) {
        const timedOut = controller.signal.aborted;
        controller.abort();
        if (timedOut && !(error instanceof FetchError)) throw new FetchError("timeout");
        throw error;
      } finally {
        clearTimeout(timer);
        this.completed.set(url.origin, Date.now());
      }
    });
  }

  private rules(origin: string): Promise<Robots> {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    const pending = this.loadRobots(origin).catch((error: unknown) => {
      this.robots.delete(origin);
      throw error;
    });
    this.robots.set(origin, pending);
    return pending;
  }

  private async loadRobots(origin: string): Promise<Robots> {
    let url = this.checked(`${origin}/robots.txt`);
    for (let hop = 0; hop <= this.options.maxRedirects; hop++) {
      const response = await this.request(url, { Accept: "text/plain" });
      const location = response.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        url = this.checked(new URL(location, url).href);
        continue;
      }
      // Missing robots permits crawling; access denial fails closed.
      if (![200, 404, 410].includes(response.status)) throw new FetchError("robots_unavailable");
      const rules = robotsParser(
        `${origin}/robots.txt`,
        response.status === 200 ? response.body.toString("utf8") : "",
      );
      const seconds = rules.getCrawlDelay(USER_AGENT);
      if (seconds !== undefined) this.crawlDelays.set(origin, seconds * 1000);
      return rules;
    }
    throw new FetchError("redirect_limit");
  }

  async fetch(value: string, previous: Validators = {}): Promise<FetchResult> {
    let url = this.checked(value);
    const validators = validatorsSchema.parse(previous);
    for (let hop = 0; hop <= this.options.maxRedirects; hop++) {
      const rules = await this.rules(url.origin);
      if (rules.isAllowed(url.href, USER_AGENT) === false) throw new FetchError("robots_denied");
      const headers: Record<string, string> = {
        Accept: "text/html, application/xhtml+xml, application/pdf",
      };
      // Validators are scoped to a representation URL, never forwarded across origins.
      if ((!validators.url && hop === 0) || validators.url === url.href) {
        if (validators.etag) headers["If-None-Match"] = validators.etag;
        if (validators.last_modified) headers["If-Modified-Since"] = validators.last_modified;
      }
      const response = await this.request(url, headers);
      const location = response.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        url = this.checked(new URL(location, url).href);
        continue;
      }
      if (response.status === 304) {
        if (!headers["If-None-Match"] && !headers["If-Modified-Since"])
          throw new FetchError("http_error");
        return { status: "not_modified", url: url.href };
      }
      if (response.status !== 200) throw new FetchError("http_error");
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type === "application/pdf")
        return {
          status: "not_supported",
          url: url.href,
          reason: "pdf_text_extraction_unavailable",
        };
      if (type !== "text/html" && type !== "application/xhtml+xml")
        throw new FetchError("content_type");
      const charset =
        /charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ??
        "utf-8";
      return {
        status: "fetched",
        url: url.href,
        html: new TextDecoder(charset).decode(response.body),
        validators: {
          url: url.href,
          ...(response.headers.has("etag") ? { etag: response.headers.get("etag") ?? "" } : {}),
          ...(response.headers.has("last-modified")
            ? { last_modified: response.headers.get("last-modified") ?? "" }
            : {}),
        },
        retrieved_at: new Date().toISOString(),
      };
    }
    throw new FetchError("redirect_limit");
  }
}
