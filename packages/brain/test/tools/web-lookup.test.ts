import { MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";
import { findOfficialPages } from "../../src/tools/impl/web/index.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const origins = ["https://www.oegk.at", "https://www.pv.at", "https://www.oesterreich.gv.at"];
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
