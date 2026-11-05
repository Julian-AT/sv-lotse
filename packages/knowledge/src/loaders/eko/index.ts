import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { z } from "zod";
import { feeRules } from "./fee-rules.ts";

const pharmaNumberSchema = z.string().regex(/^\d{7}$/u);
const packSchema = z.strictObject({
  pharmaNumber: pharmaNumberSchema,
  registrationNumber: z.string().regex(/^\d{6}$/u),
  name: z.string().min(1),
  box: z.enum(["green", "yellow-re1", "yellow-re2", "red"]),
  codes: z.string(),
  quantity: z.string().regex(/^\d+(?:,\d+)?$/u),
  unit: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  unitPriceRaw: z.string().regex(/^\d+$/u),
  classificationRaw: z.string().regex(/^\d$/u),
  divisibility: z.string(),
  priceModel: z.string(),
  packLimit: z.string(),
  notes: z.string(),
});
export type EkoPack = Readonly<z.infer<typeof packSchema>>;

export class EkoFormatError extends Error {
  constructor(file: string, line: number, detail: string) {
    super(`${file}:${line}: ${detail}`);
    this.name = "EkoFormatError";
  }
}

function lines(text: string): string[] {
  const result = text.split(/\r?\n/u);
  if (result.at(-1) === "") result.pop();
  return result;
}

function parsePack(row: string, file: string, line: number): EkoPack {
  if (row.length !== 195) throw new EkoFormatError(file, line, "expected 195 characters");
  const field = (start: number, end: number) => row.slice(start, end).trim();
  const marker = field(118, 121);
  const codes = field(121, 125);
  const box =
    marker === "G"
      ? "green"
      : marker === "R"
        ? "red"
        : marker === "Y" && codes === "RE1"
          ? "yellow-re1"
          : marker === "Y" && codes === "RE2"
            ? "yellow-re2"
            : undefined;
  const price = field(133, 140);
  if (!/^\d+$/u.test(price)) throw new EkoFormatError(file, line, "invalid price");
  const parsed = packSchema.safeParse({
    pharmaNumber: field(0, 7),
    registrationNumber: field(9, 15),
    name: field(18, 118),
    box,
    codes,
    quantity: field(125, 129),
    unit: field(129, 133),
    priceCents: Number(price),
    unitPriceRaw: field(140, 149),
    classificationRaw: field(149, 152),
    divisibility: field(158, 161),
    priceModel: field(161, 164),
    packLimit: field(164, 167),
    notes: field(167, 195),
  });
  if (!parsed.success) throw new EkoFormatError(file, line, parsed.error.message);
  return Object.freeze(parsed.data);
}

const lookupInputSchema = z.strictObject({ medicineNameExact: z.string().trim().min(1) });
export type CoverageInput = z.infer<typeof lookupInputSchema>;
export type CoveragePack = Readonly<{
  pharmaNumber: string;
  quantity: string;
  unit: string;
  box: EkoPack["box"];
  approvalRequired: boolean;
  approvalRequestedBy: "prescribing-doctor" | null;
  approvalRule:
    | "prior-approval"
    | "subsequent-control-if-conditions-met"
    | "approval-outside-conditions"
    | "no-prior-approval";
  conditionsFlag: boolean;
  ruleText: string | null;
  textModified: boolean;
}>;
export type CoverageResult = Readonly<
  typeof feeRules & {
    listed: boolean;
    packs: readonly CoveragePack[];
  }
>;
export type Eko = Readonly<{
  packs: readonly EkoPack[];
  lookupCoverage: (input: CoverageInput) => CoverageResult;
}>;

function normalizeName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-AT");
}

function parseTexts(text: string, file: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [index, row] of lines(text).entries()) {
    const match = /^\|(\d{7})\|;\|(.*)\|$/u.exec(row);
    if (!match || match[1] === undefined || match[2] === undefined || !match[2]) {
      throw new EkoFormatError(file, index + 1, "invalid text record");
    }
    if (result.has(match[1])) throw new EkoFormatError(file, index + 1, "duplicate pharma number");
    result.set(match[1], match[2]);
  }
  return result;
}

async function readTexts(
  root: string,
  name: "regeltext" | "indtext",
): Promise<Map<string, string>> {
  const file = join(root, `${name}.txt`);
  try {
    return parseTexts(
      new TextDecoder("windows-1252", { fatal: true }).decode(await readFile(file)),
      file,
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const v2 = join(root, `${name}_v2.txt`);
  const texts = parseTexts(
    new TextDecoder("utf-8", { fatal: true }).decode(await readFile(v2)),
    v2,
  );
  for (const [id, html] of texts) {
    const $ = load(html);
    $("br").replaceWith("\n");
    texts.set(id, $.root().text());
  }
  return texts;
}

async function validatePrivateData(root: string, ids: ReadonlySet<string>): Promise<void> {
  const indications = await readTexts(root, "indtext");
  for (const id of indications.keys()) {
    if (!ids.has(id)) throw new EkoFormatError("indtext", 0, "unknown pharma number");
  }
  const file = join(root, "atccode.txt");
  const rows = lines(new TextDecoder("windows-1252", { fatal: true }).decode(await readFile(file)));
  if (rows.length === 0) throw new EkoFormatError(file, 1, "empty ATC export");
  for (const [index, row] of rows.entries()) {
    if (
      row.length !== 207 ||
      !/^[A-Z](?:[0-9]{2}(?:[A-Z](?:[A-Z](?:[0-9]{2})?)?)?)?$/u.test(row.slice(0, 7).trim()) ||
      !row.slice(7).trim()
    ) {
      throw new EkoFormatError(file, index + 1, "invalid ATC record");
    }
  }
  // ATC has no pack foreign key. Neither it nor indication texts enter public objects.
}

/** The optional directory is the EKO export folder, not the SV-Box root. */
export async function loadEko(dir?: string): Promise<Eko> {
  const root = z
    .string()
    .min(1)
    .parse(
      dir ??
        join(
          resolve(
            fileURLToPath(new URL("../../../../../", import.meta.url)),
            process.env.SVBOX_DIR ?? "data/svbox",
          ),
          "Medikamenten Erstattungskodex",
        ),
    );
  const file = join(root, "medikament.txt");
  const rows = lines(new TextDecoder("windows-1252", { fatal: true }).decode(await readFile(file)));
  if (rows.length === 0) throw new EkoFormatError(file, 1, "empty export");
  const seen = new Set<string>();
  const packs = rows.map((row, index) => {
    const pack = parsePack(row, file, index + 1);
    if (seen.has(pack.pharmaNumber))
      throw new EkoFormatError(file, index + 1, "duplicate pharma number");
    seen.add(pack.pharmaNumber);
    return pack;
  });
  const rules = await readTexts(root, "regeltext");
  for (const id of rules.keys()) {
    if (!seen.has(id)) throw new EkoFormatError("regeltext", 0, "unknown pharma number");
  }
  for (const pack of packs) {
    if (pack.box.startsWith("yellow-") && !rules.has(pack.pharmaNumber)) {
      throw new EkoFormatError("regeltext", 0, "missing rule text for yellow pack");
    }
  }
  await validatePrivateData(root, seen);
  const byName = new Map<string, EkoPack[]>();
  for (const pack of packs) {
    const key = normalizeName(pack.name);
    const group = byName.get(key) ?? [];
    group.push(pack);
    byName.set(key, group);
  }
  return Object.freeze({
    packs: Object.freeze(packs),
    lookupCoverage(input: CoverageInput): CoverageResult {
      const { medicineNameExact } = lookupInputSchema.parse(input);
      const matches = byName.get(normalizeName(medicineNameExact)) ?? [];
      const coverage = matches.map((pack): CoveragePack => {
        const originalRuleText = rules.get(pack.pharmaNumber) ?? null;
        const ruleText =
          originalRuleText?.replace(
            /\b[A-Z]\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?\b/gu,
            "[ATC-Code entfernt]",
          ) ?? null;
        const conditionsFlag = pack.codes !== "" || ruleText !== null;
        const approvalRequired = pack.box === "yellow-re1" || pack.box === "red";
        return Object.freeze({
          pharmaNumber: pack.pharmaNumber,
          quantity: pack.quantity,
          unit: pack.unit,
          box: pack.box,
          approvalRequired,
          approvalRequestedBy: approvalRequired || conditionsFlag ? "prescribing-doctor" : null,
          approvalRule: approvalRequired
            ? "prior-approval"
            : pack.box === "yellow-re2"
              ? "subsequent-control-if-conditions-met"
              : conditionsFlag
                ? "approval-outside-conditions"
                : "no-prior-approval",
          conditionsFlag,
          ruleText,
          textModified: ruleText !== originalRuleText,
        });
      });
      return Object.freeze({
        ...feeRules,
        listed: matches.length > 0,
        packs: Object.freeze(coverage),
      });
    },
  });
}
