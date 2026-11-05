import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { z } from "zod";
import { assertNoLeakage } from "../../../src/checks/leakage.ts";
import { EvaluationFieldSchema } from "../../../src/e13/metrics.ts";
import { CaseSchema, SuiteSchema } from "../../../src/schema/index.ts";

const directory = new URL("../../../sets/e13/", import.meta.url);
const distribution = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const fieldSchema = EvaluationFieldSchema.extend({
  type: z.enum(["text", "date", "number", "checkbox", "choice", "signature"]),
  section: z.string().min(1),
  ownerEvidence: z
    .strictObject({ page: z.number().int().positive(), quote: z.string().min(1) })
    .optional(),
});
const documentSchema = z.strictObject({
  path: z.string().regex(/^pdfs\/[a-z0-9-]+\.pdf$/u),
  url: z.url(),
  retrievedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  attribution: z.string().min(1),
  terms: z.strictObject({ url: z.url(), passage: z.string().min(1), checkedAt: z.iso.datetime() }),
  pages: z
    .array(
      z.strictObject({
        width: z.number().positive(),
        height: z.number().positive(),
        fieldCount: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

async function dataset() {
  return z
    .strictObject({ schemaVersion: z.literal(1), suite: SuiteSchema, cases: z.array(CaseSchema) })
    .parse(JSON.parse(await readFile(new URL("gold.json", directory), "utf8")));
}

function validateBoxes(
  fields: z.infer<typeof fieldSchema>[],
  pages: z.infer<typeof documentSchema>["pages"],
) {
  for (const [index, field] of fields.entries()) {
    const { box } = field;
    const page = pages[box.page - 1];
    if (
      !page ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.x + box.width > page.width ||
      box.y + box.height > page.height
    ) {
      throw new Error("Field must lie inside its page");
    }
    for (const other of fields.slice(index + 1)) {
      const b = other.box;
      if (
        box.page === b.page &&
        Math.min(box.x + box.width, b.x + b.width) > Math.max(box.x, b.x) &&
        Math.min(box.y + box.height, b.y + b.height) > Math.max(box.y, b.y)
      ) {
        throw new Error("Field answer areas must not overlap");
      }
    }
  }
  for (const [index, page] of pages.entries()) {
    expect(fields.filter((field) => field.box.page === index + 1)).toHaveLength(page.fieldCount);
  }
}

test("E13 AC1 validates 20 unique source-backed flat official PDFs and all field counts", async () => {
  const { suite, cases } = await dataset();
  expect(suite).toMatchObject({
    id: "E13",
    minimumSetSize: 20,
    gate: {
      kind: "informational",
      metric: "targetAttainment",
      threshold: 1,
      direction: "at_least",
    },
  });
  expect(cases).toHaveLength(20);
  expect(new Set(cases.map((item) => item.id)).size).toBe(20);
  const hashes = new Set<string>();
  const paths: string[] = [];
  const terms = z
    .strictObject({
      url: z.url(),
      checkedAt: z.iso.datetime(),
      pageSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      section: z.string().min(1),
      passage: z.string().min(1),
      scope: z.string().min(1),
    })
    .parse(JSON.parse(await readFile(new URL("terms.json", directory), "utf8")));
  const allowlist = await readFile(new URL("../../../knowledge/allowlist.yaml", directory), "utf8");
  const origins = new Set(
    [...allowlist.matchAll(/origin: (https:\/\/\S+)/gu)].map((match) => match[1]),
  );
  for (const item of cases) {
    expect(item.kind).toBe("gold");
    const { document } = z.strictObject({ document: documentSchema }).parse(item.input);
    const fields = z.array(fieldSchema).min(1).parse(item.expected);
    expect(origins.has(new URL(document.url).origin)).toBe(true);
    expect(item.source?.uri).toBe(document.url);
    expect(document.retrievedAt.slice(0, 10)).toBe(document.terms.checkedAt.slice(0, 10));
    expect(document.terms.url).toBe(terms.url);
    expect(document.terms.passage).toBe(terms.passage);
    const bytes = await readFile(new URL(document.path, directory));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(document.sha256);
    hashes.add(document.sha256);
    paths.push(document.path.slice("pdfs/".length));
    const loading = getDocument({
      data: Uint8Array.from(bytes),
      standardFontDataUrl: join(distribution, "standard_fonts") + sep,
    });
    try {
      const pdf = await loading.promise;
      expect(pdf.numPages).toBe(document.pages.length);
      expect(await pdf.getFieldObjects()).toBeNull();
      expect(pdf.isPureXfa).toBe(false);
      const text: string[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        expect(viewport.width).toBeCloseTo(document.pages[number - 1]?.width ?? 0, 1);
        expect(viewport.height).toBeCloseTo(document.pages[number - 1]?.height ?? 0, 1);
        expect(
          (await page.getAnnotations()).filter((annotation) => annotation.subtype === "Widget"),
        ).toHaveLength(0);
        const content = await page.getTextContent();
        text.push(
          content.items
            .flatMap((item) => ("str" in item ? [item.str] : []))
            .join(" ")
            .normalize("NFKC")
            .replace(/\s+/gu, " "),
        );
      }
      for (const field of fields) {
        if (field.owner === "applicant") continue;
        const evidence = field.ownerEvidence;
        if (!evidence) throw new Error("Non-applicant ownership needs a printed source heading");
        expect(text[evidence.page - 1]).toContain(evidence.quote);
      }
    } finally {
      await loading.destroy();
    }
    validateBoxes(fields, document.pages);
  }
  expect(hashes.size).toBe(20);
  expect(
    cases.reduce((count, item) => count + z.array(fieldSchema).parse(item.expected).length, 0),
  ).toBe(539);
  expect((await readdir(new URL("pdfs/", directory))).sort()).toEqual(paths.sort());
});

test("E13 AC2 rejects out-of-page, zero-area, overlapping boxes and incorrect counts", () => {
  const field = {
    box: { page: 1, x: 10, y: 10, width: 20, height: 10 },
    label_de: "Name",
    owner: "applicant" as const,
    type: "text" as const,
    section: "Antragsteller",
  };
  const pages = [{ width: 100, height: 100, fieldCount: 1 }];
  validateBoxes([field], pages);
  for (const box of [
    { ...field.box, page: 2 },
    { ...field.box, width: 100 },
    { ...field.box, height: 100 },
    { ...field.box, width: 0 },
  ]) {
    expect(() => validateBoxes([{ ...field, box }], pages)).toThrow();
  }
  expect(() =>
    validateBoxes([field, field], [{ ...pages[0], width: 100, height: 100, fieldCount: 2 }]),
  ).toThrow("overlap");
  expect(() => validateBoxes([field], [{ width: 100, height: 100, fieldCount: 2 }])).toThrow();
});

test("E13 AC3 labels all fields with applicant, doctor, hospital or office section ownership", async () => {
  const owners: Record<string, number> = {};
  for (const item of (await dataset()).cases) {
    for (const field of z.array(fieldSchema).parse(item.expected)) {
      expect(field.section.trim().length).toBeGreaterThan(0);
      owners[field.owner] = (owners[field.owner] ?? 0) + 1;
    }
  }
  expect(owners).toEqual({ applicant: 501, doctor: 5, hospital: 18, office: 15 });
});

async function corpus(path: string): Promise<{ id: string; text: string }[]> {
  return (
    await Promise.all(
      (
        await readdir(path, { withFileTypes: true })
      ).map(async (entry) => {
        const file = join(path, entry.name);
        if (entry.isDirectory()) return corpus(file);
        return /\.(?:ya?ml|json)$/u.test(entry.name)
          ? [{ id: file, text: await readFile(file, "utf8") }]
          : [];
      }),
    )
  ).flat();
}

test("E13 gold passes leakage against every existing catalog record", async () => {
  assertNoLeakage(
    (await dataset()).cases,
    await corpus(fileURLToPath(new URL("../../../knowledge/catalog/", directory))),
  );
});
