import { MockLanguageModelV4 } from "ai/test";
import { afterEach, expect, test, vi } from "vitest";
import {
  deepPageOffer,
  findApplyPage,
  findOfficialPages,
  implementations,
  MAX_PAGE_READS,
  readOfficialPage,
} from "../../src/tools/impl/web/index.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const origins = [
  "https://www.oegk.at",
  "https://www.pv.at",
  "https://www.oesterreich.gv.at",
  "https://www.sozialministerium.gv.at",
];
const pflegegeld = "https://www.pv.at/web/pflegegeld/antrag";

function searchModel(text: string, sources: readonly string[]) {
  const tools: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      tools.push(options.tools);
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "ws",
            toolName: "web_search",
            input: "{}",
            providerExecuted: true,
          },
          {
            type: "tool-result" as const,
            toolCallId: "ws",
            toolName: "web_search",
            result: { action: { type: "search" } },
          },
          ...sources.map((url, index) => ({
            type: "source" as const,
            sourceType: "url" as const,
            id: `source-${index}`,
            url,
          })),
          { type: "text" as const, text },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { model, tools };
}

test("keeps only searched pages on allowlisted origins, carrier first", async () => {
  const { model, tools } = searchModel(
    [
      "https://www.oesterreich.gv.at/themen/pflege | Pflege | Überblick über Pflegeleistungen.",
      "https://www.pflegegeld-hilfe.at/antrag | Pflegegeld beantragen | Inoffizielle Seite.",
      "https://www.oegk.at/erfunden | Erfunden | Kam in keiner Suche vor.",
      `${pflegegeld}?utm_source=openai | Pflegegeld beantragen | Antrag auf Pflegegeld bei der PVA.`,
    ].join("\n"),
    [
      "https://www.oesterreich.gv.at/themen/pflege",
      "https://www.pflegegeld-hilfe.at/antrag",
      pflegegeld,
    ],
  );

  const pages = await findOfficialPages(
    { query: "Antragsformular Pflegegeld bei der PVA" },
    { model, origins },
  );

  expect(pages).toEqual([
    {
      url: pflegegeld,
      title: "Pflegegeld beantragen",
      snippet: "Antrag auf Pflegegeld bei der PVA.",
    },
    {
      url: "https://www.oesterreich.gv.at/themen/pflege",
      title: "Pflege",
      snippet: "Überblick über Pflegeleistungen.",
    },
  ]);
  expect(JSON.stringify(tools)).toContain('"allowedDomains":["www.oegk.at","www.pv.at"');
});

test("falls back to the allowlisted search results when the reply lists no usable page", async () => {
  const { model } = searchModel("Leider nichts Passendes gefunden.", [
    "https://www.pflegegeld-hilfe.at/antrag",
    pflegegeld,
  ]);

  await expect(
    findOfficialPages({ query: "Pflegegeld Antrag" }, { model, origins }),
  ).resolves.toEqual([{ url: pflegegeld, title: "www.pv.at", snippet: "" }]);
});

test("returns an empty list when the search fails", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("search unavailable");
    },
  });

  await expect(
    findOfficialPages({ query: "Pflegegeld Antrag" }, { model, origins }),
  ).resolves.toEqual([]);
});

test("prefers a deep page over a home page and keeps a home page only as the last resort", async () => {
  const ministry = "https://www.sozialministerium.gv.at/Themen/Pflege/Pflegegeld.html";
  const deep = searchModel("", ["https://www.pv.at/", ministry]);
  await expect(
    findOfficialPages({ query: "Wo beantrage ich Pflegegeld?" }, { model: deep.model, origins }),
  ).resolves.toEqual([{ url: ministry, title: "www.sozialministerium.gv.at", snippet: "" }]);

  const home = searchModel("", ["https://www.pv.at/"]);
  await expect(
    findOfficialPages({ query: "Pflegegeld" }, { model: home.model, origins }),
  ).resolves.toEqual([{ url: "https://www.pv.at", title: "www.pv.at", snippet: "" }]);
});

test("uses pages from the ingested sources when the web search fails", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("search unavailable");
    },
  });
  const known = Promise.resolve([
    { url: pflegegeld, title: "", snippet: "Den Antrag stellen Sie bei der PVA." },
    { url: "https://www.example.com/pflegegeld", title: "", snippet: "Fremde Seite." },
  ]);

  await expect(
    findOfficialPages({ query: "Pflegegeld Antrag" }, { model, origins, known }),
  ).resolves.toEqual([
    { url: pflegegeld, title: "www.pv.at", snippet: "Den Antrag stellen Sie bei der PVA." },
  ]);
});

const html = `<!doctype html><html><head><title>Pflegegeld | PVA</title></head><body>
<nav><a href="#formulare">Formulare</a><a href="/">Startseite</a><a href="https://www.facebook.com/pva">Facebook</a></nav>
<main><h1>Pflegegeld</h1><p>Das Pflegegeld beantragen Sie bei Ihrer Pensionsversicherung.</p>
<a href="/web/pflegegeld/antrag">Pflegegeld online beantragen</a>
<a href="/documents/antrag-pflegegeld.pdf">Antragsformular (PDF)</a>
<a href="https://www.pflegegeld-hilfe.at/antrag">Hilfe beim Antrag</a>
<a href="https://www.pv.at/login">Anmelden</a>
<form><label for="svnr">Sozialversicherungsnummer</label><input id="svnr" name="svnr" type="text">
<input type="hidden" name="token" value="x"><button type="submit">Senden</button></form>
</main></body></html>`;

function htmlResponse(body = html) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

test("reads allowlisted links, form fields and the PDF form of a page", async () => {
  const page = await readOfficialPage("https://www.pv.at/web/pflegegeld", {
    origins,
    fetcher: async () => htmlResponse(),
  });

  expect(page.title).toBe("Pflegegeld | PVA");
  expect(page.headings).toEqual(["Pflegegeld"]);
  expect(page.text).toContain("Das Pflegegeld beantragen Sie bei Ihrer Pensionsversicherung.");
  expect(page.links.map((link) => link.href)).toEqual([
    "https://www.pv.at/documents/antrag-pflegegeld.pdf",
    "https://www.pv.at/web/pflegegeld/antrag",
    "https://www.pv.at/",
  ]);
  expect(page.links[0]).toMatchObject({ pdf: true, form: true, apply: true });
  expect(page.formPdf).toBe("https://www.pv.at/documents/antrag-pflegegeld.pdf");
  expect(page.fields).toEqual([{ label: "Sozialversicherungsnummer", name: "svnr", type: "text" }]);
  expect(page.sources[0]?.url).toBe("https://www.pv.at/web/pflegegeld");
});

test("refuses pages and redirects outside the allowlist", async () => {
  await expect(
    readOfficialPage("https://www.pflegegeld-hilfe.at/antrag", {
      origins,
      fetcher: async () => htmlResponse(),
    }),
  ).rejects.toThrow("PAGE_NOT_ALLOWED");
  await expect(
    readOfficialPage("https://www.pv.at/weiter", {
      origins,
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/pflegegeld" },
        }),
    }),
  ).rejects.toThrow("PAGE_NOT_ALLOWED");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("caps page reads per turn", async () => {
  vi.stubGlobal("fetch", async () => htmlResponse());
  const readPage = implementations({ allowStubs: false })["web.readPage"];
  if (!readPage) throw new Error("Missing web.readPage");
  const read = () =>
    readPage({ url: "https://www.pv.at/web/pflegegeld" }, {} as never, {} as never);

  for (let index = 0; index < MAX_PAGE_READS; index++) await expect(read()).resolves.toBeTruthy();
  await expect(read()).rejects.toThrow("PAGE_READ_LIMIT");
});

test("offers the on-topic apply link of the best page for a where-to-apply request", async () => {
  vi.stubGlobal("fetch", async () =>
    htmlResponse(`<main><h1>Pflegegeld</h1>
<a href="https://www.pv.at/formulare">Anträge und Formulare</a>
<a href="https://www.pv.at/wahlkarte">Wahlkarte beantragen</a>
<a href="https://www.pv.at/web/pflegegeld/antrag">Pflegegeld online beantragen</a></main>`),
  );
  const { model } = searchModel("", ["https://www.pv.at/web/pflegegeld"]);

  await expect(
    deepPageOffer({ userTexts: ["Wo beantrage ich Pflegegeld?"], sources: [], model }),
  ).resolves.toEqual({
    target: { kind: "dom", handle: "page", url: "https://www.pv.at/web/pflegegeld/antrag" },
    label: "die Seite „Pflegegeld online beantragen“ auf pv.at",
  });
  await expect(
    deepPageOffer({ userTexts: ["Was ist Pflegegeld?"], sources: [], model }),
  ).resolves.toBeUndefined();
});

test("stays on the best page when its apply links are about something else", async () => {
  vi.stubGlobal("fetch", async () =>
    htmlResponse(`<title>Pflegegeld</title><main>
<a href="https://www.pv.at/wahlkarte">Wahlkarte beantragen</a></main>`),
  );
  const { model } = searchModel("", ["https://www.pv.at/web/pflegegeld"]);

  await expect(
    deepPageOffer({ userTexts: ["Wo beantrage ich Pflegegeld?"], sources: [], model }),
  ).resolves.toMatchObject({ target: { url: "https://www.pv.at/web/pflegegeld" } });
});

test("prefers the page that carries the topic's application form", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    htmlResponse(
      url.includes("sozialministerium")
        ? `<title>Pflegegeld in Österreich</title><main><a href="/reform">Pflegereform</a>
<a href="/formsearch/?q=pflegegeld">Formulare</a></main>`
        : `<title>Pflegegeld | PV</title><main>
<a href="https://www.pv.at/cdscontent/load?contentid=1">Antrag (PDF)</a></main>`,
    ),
  );
  const { model } = searchModel("", [
    "https://www.sozialministerium.gv.at/Themen/Pflege/Pflegegeld.html",
    "https://www.pv.at/web/pflegegeld",
  ]);

  await expect(
    deepPageOffer({ userTexts: ["Wo beantrage ich Pflegegeld?"], sources: [], model }),
  ).resolves.toEqual({
    target: { kind: "dom", handle: "page", url: "https://www.pv.at/web/pflegegeld" },
    label: "die Seite „Pflegegeld | PV“ auf pv.at",
  });
});

test("apply page: stays on the page for downloads, follows HTML apply pages, keeps the PDF", async () => {
  const sms = "https://www.sozialministeriumservice.gv.at/Angehoerige/Pflegekarenz.html";
  const pages: Record<string, string> = {
    [sms]: `<title>Pflegekarenzgeld</title><main>
<a href="/Downloads/Antrag_Pflegekarenzgeld.doc">Antrag Pflegekarenzgeld (DOC)</a></main>`,
    "https://www.pv.at/web/pflegegeld": `<title>Pflegegeld</title><main>
<a href="https://www.pv.at/web/pflegegeld/antrag">Pflegegeld online beantragen</a></main>`,
    "https://www.pv.at/web/reha": `<title>Reha</title><main>
<a href="https://www.pv.at/cdscontent/load?contentid=1">Antrag auf Rehabilitation (PDF)</a></main>`,
  };
  vi.stubGlobal("fetch", async (url: string) => htmlResponse(pages[url] ?? ""));
  const find = (query: string, page: string) =>
    findApplyPage({ query, model: searchModel("", [page]).model });

  await expect(find("Pflegekarenzgeld Antrag", sms)).resolves.toMatchObject({
    url: sms,
    apply: { text: "Antrag Pflegekarenzgeld (DOC)" },
  });
  await expect(find("Pflegekarenzgeld Antrag", sms)).resolves.not.toHaveProperty("formPdf");
  await expect(
    find("Pflegegeld Antrag", "https://www.pv.at/web/pflegegeld"),
  ).resolves.toMatchObject({ url: "https://www.pv.at/web/pflegegeld/antrag" });
  await expect(find("Rehabilitation Antrag", "https://www.pv.at/web/reha")).resolves.toMatchObject({
    url: "https://www.pv.at/web/reha",
    formPdf: "https://www.pv.at/cdscontent/load?contentid=1",
  });
});
