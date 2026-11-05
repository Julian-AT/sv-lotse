import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { chunkMarkdown } from "../../src/ingest/chunk.ts";
import { enrich } from "../../src/ingest/enrich.ts";
import { normalizeHtml } from "../../src/ingest/normalize.ts";
import { loadRegistry } from "../../src/ingest/registry.ts";

const url = "https://www.oegk.at/cdscontent/?contentid=10007.878901&portal=oegkportal";
const html = readFileSync(new URL("./fixtures/oegk-contact.html.txt", import.meta.url), "utf8");

test("saved HTML fixtures redact provider keys, verification tokens, sessions and tracking IDs", () => {
  const fixtures = new URL("./fixtures/", import.meta.url);
  const patterns = [
    /\bAIza[\w-]{35}\b/,
    /name="google-site-verification" content="(?!REDACTED")[^"]+"/,
    /;jsessionid=(?!REDACTED[?"'])[\w.-]+/,
    /data-locationfinder-token="(?!REDACTED")[^"]+"/,
    /global_(?:tag_manager_id|analyse_id)\s*=\s*"(?!REDACTED")[^"]+"/,
    /\/containers\/(?!REDACTED\/)[\w-]+\/noscript\.html/,
  ];
  for (const file of readdirSync(fixtures).filter((name) => name.endsWith(".html.txt"))) {
    const fixture = readFileSync(new URL(file, fixtures), "utf8");
    for (const pattern of patterns) {
      // Assert a boolean so a failure never prints the captured credential.
      expect(pattern.test(fixture), `${file}: ${pattern.source}`).toBe(false);
    }
  }
});

test("AC2 real ÖGK fixture normalizes stably with headings, lists and absolute links", () => {
  const result = normalizeHtml(html, url);
  expect(normalizeHtml(html, url)).toEqual(result);
  expect(result.title).toContain("Kontakt");
  expect(result.markdown).toContain("# Kontakt");
  expect(result.markdown).toContain("## Standortsuche");
  expect(result.markdown).toContain("Kundenservicestellen im Burgenland");
  expect(result.markdown).toContain("](https://www.oegk.at/");
  expect(result.markdown).not.toContain("Cookie-Einstellungen");
  expect(result.markdown).not.toContain("<script");
  const regions = [
    "Burgenland",
    "Kärnten",
    "Niederösterreich",
    "Oberösterreich",
    "Salzburg",
    "Steiermark",
    "Tirol",
    "Vorarlberg",
    "Wien",
  ];
  const regionalChunks = chunkMarkdown(result.markdown);
  for (const region of regions) {
    expect(result.markdown).toContain(`## ${region}\n`);
    const section = regionalChunks.filter((chunk) => chunk.heading_path.at(-1) === region);
    expect(section).toHaveLength(1);
    expect(section[0]?.heading_path).toEqual(["Kontakt", region]);
    expect(section[0]?.text).toContain(`Österreichische Gesundheitskasse ${region}`);
    for (const other of regions.filter((candidate) => candidate !== region)) {
      expect(section[0]?.text).not.toContain(`## ${other}\n`);
    }
  }
  const steiermark = regionalChunks.find((chunk) => chunk.heading_path.at(-1) === "Steiermark");
  expect(steiermark?.text).toContain("Josef-Pongratz-Platz 1");
  expect(steiermark?.text).toContain("8010 Graz");
  expect(steiermark?.text).toContain("Tel. +43 5 0766-15");
  expect(result.markdown).toMatchSnapshot();
  const chunks = chunkMarkdown(result.markdown);
  expect(chunkMarkdown(result.markdown)).toEqual(chunks);
  expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("Standortsuche");
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(3200);
    expect(chunk.heading_path[0]).toBe("Kontakt");
    expect(chunk.size_exception === null || chunk.size_exception === "section_tail").toBe(true);
    if (chunk.size_exception === null) expect(chunk.text.length).toBeGreaterThanOrEqual(1600);
  }
});

// Constructed administrative tables exercise spans absent from the saved page.
test("normalizer expands colspan without shifting amounts to another carrier", () => {
  const page = normalizeHtml(
    '<main><table><tr><th>Leistung</th><th>ÖGK</th><th>SVS</th></tr><tr><td colspan="2">Keine Gebühr</td><td>20 EUR</td></tr></table></main>',
    url,
  );
  expect(page.markdown).toBe(
    "| Leistung | ÖGK | SVS |\n| --- | --- | --- |\n| Keine Gebühr | Keine Gebühr | 20 EUR |",
  );
});

test("normalizer expands rowspan so following cells keep their column associations", () => {
  const page = normalizeHtml(
    '<main><table><tr><th>Ort</th><th>ÖGK</th><th>SVS</th></tr><tr><td rowspan="2">Wien</td><td>10 EUR</td><td>20 EUR</td></tr><tr><td>30 EUR</td><td>40 EUR</td></tr></table></main>',
    url,
  );
  expect(page.markdown).toContain("| Wien | 10 EUR | 20 EUR |\n| Wien | 30 EUR | 40 EUR |");
});

test("combined table spans repeat shared headers and stop at row-group boundaries", () => {
  const page = normalizeHtml(
    '<main><table><thead><tr><th rowspan="2">Ort</th><th colspan="2">Träger</th></tr><tr><th>ÖGK</th><th>SVS</th></tr></thead><tbody><tr><td rowspan="0">Wien</td><td colspan="2">Keine Gebühr</td></tr><tr><td>10 EUR</td><td>20 EUR</td></tr></tbody><tbody><tr><td>Graz</td><td>30 EUR</td><td>40 EUR</td></tr></tbody></table></main>',
    url,
  );
  expect(page.markdown).toBe(
    "| Ort | Träger / ÖGK | Träger / SVS |\n| --- | --- | --- |\n| Wien | Keine Gebühr | Keine Gebühr |\n| Wien | 10 EUR | 20 EUR |\n| Graz | 30 EUR | 40 EUR |",
  );
});

test("ARIA headings retain semantic depth and native page titles", () => {
  const page = normalizeHtml(
    '<main><h1 role="heading" aria-level="1">Kontakt</h1><div role="heading" aria-level="2">Region</div><p>Adresse</p><div role="heading" aria-level="3">Öffnungszeiten</div><p>Montag</p></main>',
    url,
  );
  expect(page.title).toBe("Kontakt");
  expect(chunkMarkdown(page.markdown).map((chunk) => chunk.heading_path)).toEqual([
    ["Kontakt", "Region"],
    ["Kontakt", "Region", "Öffnungszeiten"],
  ]);
  expect(
    normalizeHtml(
      '<main><div role="heading" aria-level="2"><a href="/service">Service</a></div><p>Kontakt</p></main>',
      url,
    ).markdown,
  ).toContain("## [Service](https://www.oegk.at/service)");
});

test("subsection validity never expires unrelated contact chunks or overrides page metadata", () => {
  const sections =
    '<main><h1>Information</h1><section><h2>Saisonangebot</h2><p>Gültig ab: 01.06.2025</p><p>Gültig bis: 31.08.2025</p></section><section><h2>Kontakt</h2><p>Gültig ab: 01.01.2026</p><p>Gültig bis: 31.12.2026</p><p>Kontaktstelle in Wien</p><meta itemprop="validThrough" content="2026-12-31"></section></main>';
  const page = normalizeHtml(sections, url);
  expect(page.valid_from).toBeNull();
  expect(page.valid_to).toBeNull();
  expect(chunkMarkdown(page.markdown)).toMatchObject([
    { heading_path: ["Information", "Saisonangebot"], text: expect.stringContaining("31.08.2025") },
    { heading_path: ["Information", "Kontakt"], text: expect.stringContaining("31.12.2026") },
  ]);
  const withMetadata = normalizeHtml(
    `<html><head><meta name="valid_from" content="2024-01-01"><meta name="valid_to" content="2027-12-31"></head><body>${sections}</body></html>`,
    url,
  );
  expect(withMetadata.valid_from).toBe("2024-01-01T00:00:00.000Z");
  expect(withMetadata.valid_to).toBe("2027-12-31T00:00:00.000Z");
  const unwrapped = normalizeHtml(
    "<main><h1>Information</h1><h2>Saisonangebot</h2><p>Gültig bis: 31.08.2025</p><h2>Kontakt</h2><p>Kontaktstelle in Wien</p></main>",
    url,
  );
  expect(unwrapped.valid_to).toBeNull();
});
test("chunker bounds large paragraphs, keeps headings and never crosses top-level sections", () => {
  const markdown = `# First\n\n## Child\n\n${"Information zur Verwaltung. ".repeat(240)}\n\n# Second\n\n${"Kontaktstelle. ".repeat(180)}`;
  const chunks = chunkMarkdown(markdown);
  expect(chunks.length).toBeGreaterThan(3);
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(3200);
    expect(chunk.heading_path.length).toBeGreaterThan(0);
    expect(chunk.text.includes("# First") && chunk.text.includes("# Second")).toBe(false);
  }
  expect(chunks[0]?.heading_path).toEqual(["First", "Child"]);
});
test("normalizer preserves tables and chunker keeps them intact with a documented oversized exception", () => {
  const result = normalizeHtml(
    "<main><h1>Service</h1><table><tr><th>Ort</th><th>Zeit</th></tr><tr><td>Wien</td><td>Montag</td></tr></table><ul><li>Kontakt</li></ul></main>",
    url,
  );
  expect(result.markdown).toContain("| Ort | Zeit |");
  expect(result.markdown).toContain("| Wien | Montag |");
  expect(result.markdown).toContain("*   Kontakt");
  const table = `| Ort | Zeit |\n| --- | --- |\n${"| Wien | Montag |\n".repeat(220)}`;
  expect(chunkMarkdown(`# Service\n\n${table}`)).toMatchObject([
    { size_exception: "oversized_table" },
  ]);
});
test("registry validates real origins, source metadata and Austrian synonym groups", async () => {
  const registry = await loadRegistry();
  expect(registry.allowlist.origins.length).toBeGreaterThanOrEqual(15);
  expect(registry.sources.length).toBeGreaterThanOrEqual(15);
  expect(registry.synonyms.groups).toContainEqual(["Spital", "Krankenhaus"]);
});
test("enrichment adds provenance, stable content hash and explicit validity only", () => {
  const page = normalizeHtml(
    '<html lang="de-AT"><head><meta name="valid_from" content="2026-01-01"></head><body><main><h1>Kontakt</h1><p>Information</p></main></body></html>',
    url,
  );
  const seed = {
    url,
    publisher: "ÖGK",
    refresh_days: 7,
    carrier: "ÖGK",
    region: "AT",
    life_situations: ["administration"],
  };
  const result = enrich(page, seed, "2026-11-05T12:00:00.000Z");
  expect(result.metadata).toMatchObject({
    url,
    carrier: "ÖGK",
    language: "de-AT",
    retrieved_at: "2026-11-05T12:00:00.000Z",
  });
  expect(result.valid_from).toBe("2026-01-01T00:00:00.000Z");
  expect(result.valid_to).toBeNull();
  expect(enrich(page, seed, "2026-11-06T12:00:00.000Z").metadata.content_hash).toBe(
    result.metadata.content_hash,
  );
});

test("normalization recognizes explicit German validity labels and rejects impossible dates", () => {
  const page = normalizeHtml(
    "<main><h1>Verwaltung</h1><p>Gültig ab: 01.01.2026</p><p>Gültig bis: 31.12.2026</p><p>Aktualisiert am 03.01.2026</p></main>",
    url,
  );
  expect(page.valid_from).toBe("2026-01-01T00:00:00.000Z");
  expect(page.valid_to).toBe("2026-12-31T00:00:00.000Z");
  expect(
    normalizeHtml("<main><p>Aktualisiert am 03.01.2026</p></main>", url).valid_from,
  ).toBeNull();
  expect(normalizeHtml("<main><p>Gültig ab: 30.02.2026</p></main>", url).valid_from).toBeNull();
});
