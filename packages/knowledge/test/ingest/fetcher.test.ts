import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { IngestionFetcher } from "../../src/ingest/fetcher.ts";

let server: Server;
let origin: string;
const visits: { path: string; time: number; etag: string | undefined }[] = [];
beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    visits.push({ path, time: Date.now(), etag: request.headers["if-none-match"] });
    if (path === "/robots.txt") {
      response.end("User-agent: *\nDisallow: /private\n");
    } else if (path === "/redirect") {
      response.writeHead(302, { location: "https://example.org/blocked" }).end();
    } else if (path === "/internal-redirect") {
      response.writeHead(302, { location: "/private" }).end();
    } else if (path === "/large") {
      response.writeHead(200, { "content-type": "text/html" }).end("x".repeat(2000));
    } else if (path === "/slow") {
      setTimeout(() => response.end("slow"), 150);
    } else if (path === "/pdf") {
      response.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.7");
    } else if (path === "/unexpected-304") {
      response.writeHead(304).end();
    } else if (path === "/plain") {
      response.writeHead(200, { "content-type": "text/plain" }).end("unsupported");
    } else if (path === "/loop") {
      response.writeHead(302, { location: "/loop" }).end();
    } else if (request.headers["if-none-match"] === '"v1"') {
      response.writeHead(304).end();
    } else {
      response.writeHead(200, { "content-type": "text/html", etag: '"v1"' });
      response.end("<main><h1>Kontakt</h1><p>Information</p></main>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function fetcher(options = {}) {
  return new IngestionFetcher([origin], { delayMs: 15, ...options });
}

test("AC1 refuses an unlisted origin before making a request", async () => {
  await expect(fetcher().fetch("https://example.org/")).rejects.toMatchObject({
    code: "origin_denied",
  });
});
test("AC1 rechecks a redirect origin and the target robots rules", async () => {
  await expect(fetcher().fetch(`${origin}/redirect`)).rejects.toMatchObject({
    code: "origin_denied",
  });
  await expect(fetcher().fetch(`${origin}/internal-redirect`)).rejects.toMatchObject({
    code: "robots_denied",
  });
});
test("AC1 respects a robots disallow without fetching the page", async () => {
  const count = visits.length;
  await expect(fetcher().fetch(`${origin}/private`)).rejects.toMatchObject({
    code: "robots_denied",
  });
  expect(visits.slice(count).map((visit) => visit.path)).toEqual(["/robots.txt"]);
});
test("conditional requests preserve validators and yield not_modified", async () => {
  const client = fetcher();
  const first = await client.fetch(`${origin}/page`);
  expect(first.status).toBe("fetched");
  expect(await client.fetch(`${origin}/page`, { etag: '"v1"' })).toMatchObject({
    status: "not_modified",
  });
  expect(visits.at(-1)?.etag).toBe('"v1"');
});
test("per-origin requests including robots are serial and delayed", async () => {
  const client = fetcher({ delayMs: 35 });
  const count = visits.length;
  await Promise.all([client.fetch(`${origin}/a`), client.fetch(`${origin}/b`)]);
  const times = visits.slice(count).map((visit) => visit.time);
  expect(times).toHaveLength(3);
  for (let index = 1; index < times.length; index++) {
    expect((times[index] ?? 0) - (times[index - 1] ?? 0)).toBeGreaterThanOrEqual(30);
  }
});
test("fetcher bounds size and time and returns an explicit unsupported PDF record", async () => {
  await expect(fetcher({ maxBytes: 1000 }).fetch(`${origin}/large`)).rejects.toMatchObject({
    code: "size_limit",
  });
  await expect(fetcher({ timeoutMs: 30 }).fetch(`${origin}/slow`)).rejects.toMatchObject({
    code: "timeout",
  });
  expect(await fetcher().fetch(`${origin}/pdf`)).toMatchObject({
    status: "not_supported",
    reason: "pdf_text_extraction_unavailable",
  });
});

test("fetcher rejects redirect loops, unsupported media and unsolicited 304 responses", async () => {
  await expect(fetcher({ maxRedirects: 1 }).fetch(`${origin}/loop`)).rejects.toMatchObject({
    code: "redirect_limit",
  });
  await expect(fetcher().fetch(`${origin}/plain`)).rejects.toMatchObject({ code: "content_type" });
  await expect(fetcher().fetch(`${origin}/unexpected-304`)).rejects.toMatchObject({
    code: "http_error",
  });
});
