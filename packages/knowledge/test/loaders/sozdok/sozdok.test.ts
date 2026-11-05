import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { chunkSozdok, sozdokCitation } from "../../../src/loaders/sozdok/chunk.ts";
import {
  parseSozdok,
  readSozdok,
  type SozdokRecord,
  sozdokDirectory,
} from "../../../src/loaders/sozdok/parse.ts";
import { groupVersions, inForceOn } from "../../../src/loaders/sozdok/versions.ts";

let records: SozdokRecord[];
let elapsed: number;
beforeAll(async () => {
  const start = performance.now();
  records = await readSozdok();
  elapsed = performance.now() - start;
}, 60_000);

test("AC1 parses all 14,244 real SV-Box files in under 60 seconds", () => {
  expect(records).toHaveLength(14_244);
  expect(elapsed).toBeLessThan(60_000);
  expect(records.every((record) => record.dokid && record.text && record.in_force_from)).toBe(true);
  console.info(JSON.stringify({ files: records.length, parse_ms: Math.round(elapsed) }));
});

test("AC2 every real provision resolves to its single version, including gldart", () => {
  const groups = groupVersions(records);
  expect(groups.size).toBe(records.length);
  for (const versions of groups.values()) {
    expect(versions).toHaveLength(1);
    const version = versions[0];
    if (!version) throw new Error("Missing version");
    expect(inForceOn(versions, version.in_force_from)).toEqual(version);
    expect(version.in_force_to).toBeNull();
  }
});

test("AC2 selects before, on, between and after dates from a real-file version history", async () => {
  const original = records.find((record) => record.in_force_from === "2004-03-15");
  if (!original) throw new Error("Missing real history seed");
  const xml = await readFile(join(sozdokDirectory(), original.file), "utf8");
  // The snapshot has no history: change only in-force date and text in a real file.
  const later = parseSozdok(
    xml
      .replace('ikra="2004-03-15"', 'ikra="2010-01-01"')
      .replace("</absatz>", " Neuer Wortlaut.</absatz>"),
    original.file,
  );
  const latest = parseSozdok(
    xml
      .replace('ikra="2004-03-15"', 'ikra="2020-01-01"')
      .replace("</absatz>", " Neuester Wortlaut.</absatz>"),
    original.file,
  );
  const versions = [...groupVersions([latest, original, later]).values()][0];
  if (!versions) throw new Error("Missing history");
  expect(inForceOn(versions, "2004-03-14")).toBeUndefined();
  expect(inForceOn(versions, "2004-03-15")?.text).toBe(original.text);
  expect(inForceOn(versions, "2009-12-31")?.in_force_to).toBe("2010-01-01");
  expect(inForceOn(versions, "2010-01-01")?.text).toBe(later.text);
  expect(inForceOn(versions, "2019-12-31")?.in_force_to).toBe("2020-01-01");
  expect(inForceOn(versions, "2020-01-01")?.text).toBe(latest.text);
  expect(inForceOn(versions, "2030-01-01")?.in_force_to).toBeNull();
  expect(() => inForceOn(versions, "2020-02-30")).toThrow();
  expect(groupVersions([original, { ...original, gldart: "ART" }]).size).toBe(2);
  expect(() => groupVersions([original, original])).toThrow(/ambiguous/i);
});

test("AC3 chunks all real versions without crossing provisions or losing text", () => {
  for (const versions of groupVersions(records).values()) {
    for (const version of versions) {
      const chunks = chunkSozdok(version);
      expect(chunks.map((chunk) => chunk.text).join("\n\n")).toBe(version.text);
      for (const chunk of chunks) {
        expect(chunk.metadata).toMatchObject({
          kind: "legal",
          dokid: version.dokid,
          file: version.file,
          law_abbr: version.law_abbr,
          paragraph: version.paragraph,
          gldart: version.gldart,
        });
        expect(chunk.citation).toBe(sozdokCitation(version));
      }
    }
  }
});

test("AC3 matches the PRD citation format for five real sampled paragraphs", () => {
  const samples = [
    [
      "ABVO_1996=PARA=1=301=1996-06-28=1996-07-01.xml",
      "§ 1 ABVO 1996 (SozDok, in Kraft seit 01.07.1996)",
    ],
    [
      "ABVO_1996=PARA=2=301=1996-06-28=1996-07-01.xml",
      "§ 2 ABVO 1996 (SozDok, in Kraft seit 01.07.1996)",
    ],
    ...[3, 10, 11].map((number) => [
      `AbrGr_andere_Vertragspartner=PARA=${number}=29=2004-03-26=2004-03-15.xml`,
      `§ ${number} AbrGr andere Vertragspartner (SozDok, in Kraft seit 15.03.2004)`,
    ]),
  ];
  for (const [file, citation] of samples) {
    const record = records.find((entry) => entry.file === file);
    expect(record, file).toBeDefined();
    if (!record) throw new Error(`Missing sample ${file}`);
    expect(sozdokCitation(record)).toBe(citation);
  }
});

test("preserves mixed XML order, numbering, lists, tables, umlauts and non-breaking spaces", async () => {
  const file = "ABVO_1996=PARA=1=301=1996-06-28=1996-07-01.xml";
  const xml = await readFile(join(sozdokDirectory(), file), "utf8");
  const record = parseSozdok(xml, file);
  expect(record.text).toContain("§\u00a01. (1) Zum Nachweis");
  expect(record.text).toContain("(2) Die Bestätigung gemäß Abs. 1");
  expect(record.text).toContain("1. den Familien- und Vornamen");
  expect(record.text.indexOf("11.")).toBeLessThan(record.text.indexOf("(3)"));
  expect(record.text).toContain("des Arbeitslosenversicherungsgesetzes 1977");
  expect(record.publication_refs[0]).toMatchObject({ puborg: "BGBl.", nrpuborg: "301" });
  expect(record.decided_at).toBeNull();
  expect(record.paragraph).toEqual({ gldnr: "1", gldsym: "§\u00a01." });
  const table = records.find((entry) => entry.text.includes("\t"));
  expect(table).toBeDefined();
});

test("splits oversized provisions only at absatz boundaries and keeps long absatz intact", () => {
  const original = records[0];
  if (!original) throw new Error("Missing real seed");
  const paragraphs = ["a".repeat(4000), "b".repeat(4000), "c".repeat(9000)];
  const chunks = chunkSozdok({
    ...original,
    in_force_to: null,
    absatz: paragraphs,
    text: paragraphs.join("\n\n"),
  });
  expect(chunks.map((chunk) => chunk.text)).toEqual(paragraphs);
});

test("AC3 splits the real contract table within budget and preserves complete rows when they fit", () => {
  const record = records.find((entry) =>
    entry.file.startsWith("GesamtvertragsK_und_andere_Vertraege_1948_bis_2009="),
  );
  if (!record) throw new Error("Missing real contract table");
  expect(record.absatz.length).toBeGreaterThan(1000);
  const version = { ...record, in_force_to: null };
  const chunks = chunkSozdok(version);
  expect(chunks.length).toBeGreaterThan(10);
  expect(chunks.every((chunk) => Array.from(chunk.text).length <= 6000)).toBe(true);
  const rowCells = [
    "Ärzte: e–card Gesamtvertrag mit Beilage zu §\u00a06 Abs.\u00a01",
    "1/2009",
    "35-42\n50-58",
    "62",
    "16. 12. 2004",
    "HVSV, SV-Träger",
    "BKNÄ, Landeskurien",
  ];
  expect(chunks.some((chunk) => chunk.text.includes(rowCells.join("\n\n")))).toBe(true);
  // A smaller caller budget must expose cell absatz rather than make a row oversized.
  for (const chunk of chunkSozdok(version, 100)) {
    if (Array.from(chunk.text).length > 400) expect(record.absatz).toContain(chunk.text);
  }
});

test("preserves real Canada agreement dates and maps footnote markers to numbered bodies", () => {
  const record = records.find((entry) => entry.file.startsWith("AbkSozSi_Kanada_2023=EINL="));
  if (!record) throw new Error("Missing real Canada agreement introduction");
  expect(record.text).toContain("24. Februar 1987[1] in Wien");
  expect(record.text).toContain("12. September 1995[2] in Wien");
  expect(record.text).not.toContain("19871");
  expect(record.text).toContain("[1] Kundgemacht in BGBl. Nr. 451/1987.");
  expect(record.text).toContain("[2] Kundgemacht in BGBl. Nr. 570/1996");
  expect(record.text).toContain("[3] Kundgemacht in BGBl. Nr. 66/1966.");
  expect(record.text).toContain("[4] Kundgemacht in BGBl. Nr. 318/1969.");
});

test("real Israel Article 3 uses embedded footnote labels instead of conflicting nr attributes", () => {
  const record = records.find((entry) => entry.file.startsWith("AbkSozSi_Israel=ART=3="));
  if (!record) throw new Error("Missing real Israel agreement Article 3");
  expect(record.text).toContain("[2] Kundgemacht in BGBl. Nr. 55/1955");
  expect(record.text).toContain("[3] Kundgemacht in BGBl. Nr. 78/1974");
  expect(record.text).not.toContain("[1]");
  expect(record.text).not.toMatch(/\[\d+\]\s*\[\d+\]/);
  expect(record.text).toContain("Flüchtlinge [2])");
  expect(record.text).toContain("1967 [3])");
});

test("structural errors name the file and optional metadata can be absent", async () => {
  const original = records[0];
  if (!original) throw new Error("Missing real seed");
  const xml = await readFile(join(sozdokDirectory(), original.file), "utf8");
  for (const broken of [
    "<sozdok>",
    "<other/>",
    xml.replace(/ ikra="[^"]*"/, ""),
    xml.replace(/ ikra="[^"]*"/, ' ikra="2025-02-30"'),
    xml.replace("<nutzdaten>", "<other>").replace("</nutzdaten>", "</other>"),
  ]) {
    expect(() => parseSozdok(broken, "broken.xml")).toThrow(/broken\.xml/);
  }
  const optional = xml.replace(/ (beschdat|pubdat|urheber|sichtbarkeit)="[^"]*"/g, "");
  expect(parseSozdok(optional, original.file)).toMatchObject({
    published_at: null,
    decided_at: null,
    publisher: null,
    visibility: null,
  });
});
