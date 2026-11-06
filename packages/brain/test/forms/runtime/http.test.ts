import { afterEach, describe, expect, it, vi } from "vitest";
import { officialPdfLinks } from "../../../src/forms/acquire/find.ts";
import { fetchOfficial, officialUrl } from "../../../src/forms/acquire/http.ts";

const origins = new Set(["https://official.test"]);
afterEach(() => vi.unstubAllGlobals());

describe("FR-D10 acquisition boundary", () => {
  it("rejects HTTP, credentials, origin lookalikes and redirects before fetching the destination", async () => {
    for (const url of [
      "http://official.test/a.pdf",
      "https://user@official.test/a.pdf",
      "https://official.test.evil/a.pdf",
      "file:///private/a.pdf",
    ])
      expect(() => officialUrl(url, origins)).toThrow("FORM_ORIGIN_DENIED");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://evil.test/stolen.pdf" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(fetchOfficial("https://official.test/a.pdf", origins)).rejects.toThrow(
      "FORM_ORIGIN_DENIED",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds streamed responses and honors cancellation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("large", { headers: { "content-length": "100000000" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchOfficial("https://official.test/a.pdf", origins)).rejects.toThrow(
      "FORM_DOWNLOAD_FAILED",
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchOfficial("https://official.test/a.pdf", origins, controller.signal),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("discovers only published PDF links from exact allowlisted origins", () => {
    const links = officialPdfLinks(
      '<a href="/forms/a.pdf?x=1&amp;y=2">Antrag</a><a href="https://evil.test/form.pdf">Other</a><a href="/login">Login</a>',
      "https://official.test/forms",
      origins,
    );
    expect(links).toEqual([{ title: "Antrag", url: "https://official.test/forms/a.pdf?x=1&y=2" }]);
  });
});
