import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";
import { assertNoLeakage } from "../../../src/checks/leakage.ts";
import { CaseSchema, SuiteSchema } from "../../../src/schema/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const datasetPath = join(root, "packages/evals/sets/e12/gold.json");

function svboxDirectory(directory: string | undefined): string {
  return resolve(root, directory ?? "data/svbox");
}

test("E12 resolves default and relative SV-Box directories from the repository root", () => {
  expect(svboxDirectory(undefined)).toBe(join(root, "data/svbox"));
  expect(svboxDirectory("data/svbox")).toBe(join(root, "data/svbox"));
  expect(svboxDirectory(join(root, "data/svbox"))).toBe(join(root, "data/svbox"));
});

const span = z.strictObject({
  quote: z.string().min(1),
  page: z.number().int().positive(),
  position: z
    .strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .refine(({ start, end }) => end > start),
});
const annotation = span.extend({
  id: z.string().min(1),
  factType: z.enum([
    "institution",
    "document_date",
    "visit_date",
    "discharge_date",
    "case_number",
    "carrier",
    "follow_up",
    "documented_recommendation",
    "insurance_hint",
    "open_task",
    "named_medicine",
    "vaccination_record",
  ]),
});
const documentSchema = z.discriminatedUnion("origin", [
  z.strictObject({
    origin: z.literal("svbox"),
    path: z.string().regex(/^Befunde\/[^/]+\.pdf$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageCount: z.number().int().positive(),
  }),
  z.strictObject({
    origin: z.literal("synthetic"),
    pages: z.array(z.string().min(1)).min(1),
  }),
]);
const dataset = () =>
  z
    .strictObject({
      schemaVersion: z.literal(1),
      suite: SuiteSchema,
      cases: z.array(CaseSchema),
      exclusions: z.array(
        span.extend({
          caseId: z.string().min(1),
          reason: z.enum(["clinical_content", "conflicting_demographics"]),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(datasetPath, "utf8")));

function pagesFor(input: unknown): string[] {
  const { document } = z.object({ document: documentSchema }).parse(input);
  if (document.origin === "synthetic") return document.pages;
  const svboxDir = svboxDirectory(process.env.SVBOX_DIR);
  const path = join(svboxDir, document.path);
  expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(document.sha256);
  const pages = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
    encoding: "utf8",
  }).split("\f");
  if (pages.at(-1) === "") pages.pop();
  expect(pages).toHaveLength(document.pageCount);
  return pages;
}

function assertSpan(pages: string[], item: z.infer<typeof span>): void {
  const page = pages[item.page - 1];
  expect(page).toBeDefined();
  expect(page?.slice(item.position.start, item.position.end)).toBe(item.quote);
}

function catalogCorpus(directory: string): { id: string; text: string }[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return catalogCorpus(path);
    return /\.(?:yaml|yml|json)$/u.test(entry.name)
      ? [{ id: path, text: readFileSync(path, "utf8") }]
      : [];
  });
}

test("E12 AC1 validates five original PDFs and ten labelled synthetic documents through the harness", () => {
  const { suite, cases } = dataset();
  expect(suite).toMatchObject({
    id: "E12",
    minimumSetSize: 30,
    gate: { metric: "precision", threshold: 0.98 },
  });
  expect(cases).toHaveLength(15);
  expect(new Set(cases.map((item) => item.id)).size).toBe(15);
  const originals = cases.filter((item) => item.kind === "gold");
  expect(originals).toHaveLength(5);
  const actualFiles = readdirSync(join(svboxDirectory(process.env.SVBOX_DIR), "Befunde"))
    .filter((name) => name.endsWith(".pdf"))
    .sort();
  expect(
    originals
      .map((item) => {
        const { document } = z.object({ document: documentSchema }).parse(item.input);
        expect(document.origin).toBe("svbox");
        if (document.origin !== "svbox") throw new Error("Expected original PDF");
        expect(item.source?.uri).toBe(`svbox:///${encodeURI(document.path)}`);
        return document.path.slice("Befunde/".length);
      })
      .sort(),
  ).toEqual(actualFiles);
  for (const item of cases.filter((item) => item.kind === "synthetic")) {
    expect(item.tags).toContain("synthetic");
    const { document } = z.object({ document: documentSchema }).parse(item.input);
    expect(document.origin).toBe("synthetic");
    expect(pagesFor(item.input).every((page) => page.includes("SYNTHETISCH"))).toBe(true);
  }
});

test("E12 AC2 every gold quote and page-local position matches the original PDF text layer or synthetic text", () => {
  let total = 0;
  for (const item of dataset().cases) {
    const pages = pagesFor(item.input);
    const { annotations } = z
      .strictObject({ annotations: z.array(annotation).min(1) })
      .parse(item.expected);
    total += annotations.length;
    expect(new Set(annotations.map((entry) => entry.id)).size).toBe(annotations.length);
    if (item.tags.includes("vaccinations")) {
      expect(annotations.filter((entry) => entry.factType === "vaccination_record")).toHaveLength(
        9,
      );
      for (const entry of annotations.filter((entry) => entry.factType === "vaccination_record")) {
        expect(entry.quote).toContain("Impfstoff:");
        expect(entry.quote).toContain("Impfdatum:");
        expect(entry.quote).toContain("Ch.-Nr.:");
      }
    }
    for (const entry of annotations) assertSpan(pages, entry);
    expect(item.source?.passage).toBe(annotations[0]?.quote);
  }
  expect(total).toBe(125);
});

test("E12 AC3 gold contains only typed verbatim administrative items and recommendations outside clinical exclusions", () => {
  const { cases, exclusions } = dataset();
  expect(new Set(exclusions.map((item) => item.caseId))).toEqual(
    new Set(cases.map((item) => item.id)),
  );
  for (const excluded of exclusions) {
    const item = cases.find((entry) => entry.id === excluded.caseId);
    if (!item) throw new Error("Unknown exclusion source");
    assertSpan(pagesFor(item.input), excluded);
    const { annotations } = z.object({ annotations: z.array(annotation) }).parse(item.expected);
    for (const entry of annotations.filter((entry) => entry.page === excluded.page)) {
      expect(
        entry.position.end <= excluded.position.start ||
          entry.position.start >= excluded.position.end,
      ).toBe(true);
    }
  }
});

test("E12 source-backed gold passes leakage against every existing catalog record", () => {
  assertNoLeakage(dataset().cases, catalogCorpus(join(root, "packages/knowledge/catalog")));
});
