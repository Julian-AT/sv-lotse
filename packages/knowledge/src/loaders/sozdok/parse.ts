import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";

export const sozdokDate = z.iso.date();
const required = z.string().trim().min(1);
const metadataSchema = z.object({
  abkrvo: required,
  titrvo: required,
  dokart: required,
  gldart: required.optional(),
  gldnr: z.string().trim(),
  pubdat: sozdokDate.optional(),
  ikra: sozdokDate,
  beschdat: sozdokDate.optional(),
  urheber: required.optional(),
  sichtbarkeit: required.optional(),
});

export interface SozdokRecord {
  dokid: string;
  law_abbr: string;
  law_title: string;
  doc_type: string;
  gldart: string;
  paragraph: { gldnr: string; gldsym: string | null };
  heading: string | null;
  text: string;
  /** Ordered, indivisible absatz units, including following lists. */
  absatz: string[];
  /** Preferred table row groups, with exclusive end offsets into absatz. */
  table_rows?: { start: number; end: number }[];
  /** Legal provisions within a multi-provision file; offsets into absatz, end exclusive. */
  provision_ranges?: {
    start: number;
    end: number;
    gldart: string;
    paragraph: SozdokRecord["paragraph"];
  }[];
  published_at: string | null;
  in_force_from: string;
  decided_at: string | null;
  publisher: string | null;
  publication_refs: Record<string, string>[];
  visibility: string | null;
  file: string;
}

interface Element {
  name: string;
  attributes: Record<string, string>;
  children: (Element | string)[];
}
const objectSchema = z.record(z.string(), z.unknown());
const attributesSchema = z.record(z.string(), z.string());
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

function elements(input: unknown): (Element | string)[] {
  return z
    .array(z.unknown())
    .parse(input)
    .map((value) => {
      const node = objectSchema.parse(value);
      if ("#text" in node) return z.string().parse(node["#text"]);
      const names = Object.keys(node).filter((name) => name !== ":@");
      const name = names[0];
      if (names.length !== 1 || !name) throw new Error("Invalid XML node");
      return {
        name,
        attributes: node[":@"] === undefined ? {} : attributesSchema.parse(node[":@"]),
        children: elements(node[name]),
      };
    });
}

function children(node: Element, name: string): Element[] {
  return node.children.filter(
    (child): child is Element => typeof child !== "string" && child.name === name,
  );
}
function one(node: Element, name: string): Element {
  const matches = children(node, name);
  const result = matches[0];
  if (matches.length !== 1 || !result) throw new Error(`Expected one ${name}`);
  return result;
}
function descendants(node: Element, name: string): Element[] {
  return node.children.flatMap((child) =>
    typeof child === "string"
      ? []
      : [...(child.name === name ? [child] : []), ...descendants(child, name)],
  );
}

const literals: Record<string, string> = {
  br: "\n",
  nbsp: "\u00a0",
  tab: "\t",
  gdash: "–",
  bdash: "—",
  amp: "&",
  lt: "<",
  gt: ">",
};
const blocks = new Set([
  "absatz",
  "ueberschrift",
  "listelem",
  "tr",
  "abschnitt",
  "schluss",
  "schlussteil",
  "fntext",
  "unterschrift",
]);
function render(
  node: Element | string,
  boundaries = false,
  atomic = false,
  provisionSymbols?: string[],
): string {
  if (typeof node === "string") return node.replace(/[\r\n\t ]+/g, " ");
  if (Object.hasOwn(literals, node.name)) return literals[node.name] ?? "";
  // Binary payloads and their source paths are not legal text.
  if (node.name === "binary" || node.name === "src") return "";
  const isAbsatz = node.name === "absatz";
  const content = node.children
    .map((child) =>
      render(
        child,
        boundaries,
        node.name === "table"
          ? false
          : atomic || isAbsatz || node.name === "liste" || node.name === "fntext",
        provisionSymbols,
      ),
    )
    .join("");
  if (boundaries && node.name === "gldsym" && provisionSymbols) {
    provisionSymbols.push(clean(content));
    return `\u0003${content}`;
  }
  if (node.name === "fnzeichen") return `[${clean(content)}]`;
  if (node.name === "fntext") {
    const body = clean(content);
    const embedded = /^\[([^\]]+)\]\s*\)?\s*/.exec(body);
    const label = embedded?.[1] ?? node.attributes.nr;
    if (label) return `\n[${label}] ${embedded ? body.slice(embedded[0].length) : body}\n`;
  }
  if (boundaries && node.name === "tr" && !atomic) return `\u0001\n${content}\n\u0002`;
  const prefix = boundaries && isAbsatz && !atomic ? "\u0000" : "";
  if (node.name === "td" || node.name === "h-td") return `${content}\t`;
  if (node.name === "symbol") return `${content} `;
  return blocks.has(node.name) ? `${prefix}\n${content}\n` : content;
}
function clean(text: string): string {
  return text
    .replace(/ +/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t\n]+|[ \t\n]+$/g, "");
}

function textUnits(
  content: Element,
): Required<Pick<SozdokRecord, "absatz" | "table_rows" | "provision_ranges">> {
  const absatz: string[] = [];
  const table_rows: { start: number; end: number }[] = [];
  const provision_ranges: NonNullable<SozdokRecord["provision_ranges"]> = [];
  const provisionSymbols: string[] = [];
  let symbolIndex = 0;
  let provision: (typeof provision_ranges)[number] | undefined;
  const rowStarts: number[] = [];
  let pending = "";
  let firstBoundary = true;
  const flush = () => {
    const text = clean(pending);
    if (text) absatz.push(text);
    pending = "";
  };
  for (const character of render(content, true, false, provisionSymbols)) {
    if (character === "\u0003") {
      const symbol = provisionSymbols[symbolIndex++] ?? "";
      const match = /^(§|Art\.|Artikel)\s*(\d+[a-z]*|[IVXLCDM]+)\.?$/iu.exec(symbol);
      if (!match) continue;
      const gldart = match[1] === "§" ? "PARA" : "ART";
      const gldnr = required.parse(match[2]);
      if (provision?.gldart === gldart && provision.paragraph.gldnr === gldnr) continue;
      if (provision) {
        flush();
        provision.end = absatz.length;
      }
      provision = {
        // Keep an unnumbered preamble with the first provision.
        start: provision ? absatz.length : 0,
        end: 0,
        gldart,
        paragraph: { gldnr, gldsym: symbol },
      };
      provision_ranges.push(provision);
    } else if (character === "\u0000") {
      // Keep a leading heading/footnote block with the first absatz.
      if (!firstBoundary) flush();
    } else if (character === "\u0001") {
      flush();
      rowStarts.push(absatz.length);
    } else if (character === "\u0002") {
      flush();
      const start = rowStarts.pop();
      if (start !== undefined && start < absatz.length)
        table_rows.push({ start, end: absatz.length });
    } else {
      pending += character;
      continue;
    }
    firstBoundary = false;
  }
  flush();
  if (provision) provision.end = absatz.length;
  return { absatz, table_rows, provision_ranges };
}

export class SozdokParseError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    super(`Invalid SozDok XML in ${file}`, { cause });
    this.name = "SozdokParseError";
  }
}

export function parseSozdok(xml: string, file: string): SozdokRecord {
  try {
    // The snapshot needs no DTD. Reject declarations instead of expanding custom entities.
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new Error("Malformed XML");
    const roots = elements(parser.parse(xml)).filter(
      (node): node is Element => typeof node !== "string",
    );
    const root = roots[0];
    if (roots.length !== 1 || root?.name !== "sozdok") throw new Error("Expected sozdok root");
    const dokid = required.parse(root.attributes.dokid);
    const rvo = one(root, "rvo");
    const metadata = one(rvo, "metadaten");
    const data = metadataSchema.parse(metadata.attributes);
    const content = one(rvo, "nutzdaten");
    const { absatz, table_rows, provision_ranges } = textUnits(content);
    const text = absatz.join("\n\n");
    required.parse(text);
    return {
      dokid,
      law_abbr: data.abkrvo,
      law_title: data.titrvo,
      doc_type: data.dokart,
      // Ten real snapshot files omit gldart; the document ID retains it.
      gldart: data.gldart ?? required.parse(dokid.split("=")[1]),
      paragraph: {
        gldnr: data.gldnr,
        gldsym:
          clean(
            descendants(content, "gldsym")
              .map((node) => render(node))
              .join(" "),
          ) || null,
      },
      heading:
        descendants(content, "ueberschrift")
          .map((node) => clean(render(node)))
          .filter(Boolean)
          .join("\n") || null,
      text,
      absatz,
      table_rows,
      ...(provision_ranges.length > 1 ? { provision_ranges } : {}),
      published_at: data.pubdat ?? null,
      in_force_from: data.ikra,
      decided_at: data.beschdat ?? null,
      publisher: data.urheber ?? null,
      publication_refs: descendants(metadata, "puborgan").map((node) => node.attributes),
      visibility: data.sichtbarkeit ?? null,
      file,
    };
  } catch (cause) {
    throw new SozdokParseError(file, cause);
  }
}

const directoryEnvironment = z.object({ SVBOX_DIR: required.optional() });
export function sozdokDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const config = directoryEnvironment.parse(environment);
  return join(
    config.SVBOX_DIR
      ? resolve(fileURLToPath(new URL("../../../../../", import.meta.url)), config.SVBOX_DIR)
      : fileURLToPath(new URL("../../../../../data/svbox/", import.meta.url)),
    "Rechtstexte",
  );
}

export async function readSozdok(directory = sozdokDirectory()): Promise<SozdokRecord[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".xml"))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (entries.length === 0) throw new Error(`No SozDok XML files in ${directory}`);
  const records: SozdokRecord[] = [];
  // Bounded batches avoid opening the entire snapshot at once.
  for (let offset = 0; offset < entries.length; offset += 32) {
    const batch = await Promise.all(
      entries.slice(offset, offset + 32).map(async (entry) => {
        const path = join(directory, entry.name);
        return parseSozdok(await readFile(path, "utf8"), entry.name);
      }),
    );
    records.push(...batch);
  }
  return records;
}
