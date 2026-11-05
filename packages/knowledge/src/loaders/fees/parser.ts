import type { TextLine } from "./pdf.ts";
import {
  type FeePosition,
  FeePositionSchema,
  type FeeSchedule,
  type ScheduleKind,
} from "./schema.ts";

const euro = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/;
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const lineText = (line: TextLine) => normalize(line.cells.map((c) => c.text).join(" "));
const amountOf = (value: string) => Number(value.replaceAll(".", "").replace(",", "."));

interface Anchor {
  index: number;
  code: string;
}

function styria(pages: TextLine[][], file: string): FeeSchedule {
  const positions: FeePosition[] = [];
  const unparsed: FeeSchedule["unparsed"] = [];
  let candidateCount = 0;
  let parsedCount = 0;
  for (const [pageIndex, lines] of pages.entries()) {
    const header = lines.findIndex((l) => lineText(l).startsWith("Pos.Nr.:"));
    const section = lines.map(lineText).find((t) => /^ABSCHNITT [IVX]+(?:\/[A-C])?$/.test(t));
    if (pageIndex < 24 || header < 0 || !section) continue;
    const unit = lineText(lines[header] ?? { y: 0, cells: [] }).includes("Pkt.") ? "points" : "EUR";
    // Tables without a rate column (e.g. MKP references) do not publish a tariff.
    if (!lines.slice(header, header + 2).some((l) => /€|Pkt\./.test(lineText(l)))) continue;
    const body = lines.slice(header + 1).filter((l) => l.y > 50);
    const anchors: Anchor[] = [];
    for (const [index, line] of body.entries()) {
      const left = line.cells
        .filter((c) => c.x >= 65 && c.x < 105)
        .map((c) => c.text)
        .join(" ")
        .replace(/(?<=\d)\s+(?=\d)/g, "");
      const match = left && /^(?:x\s*)?(\d{3}|MAMSON)(?:\s*\+)?(?:\s+(.*))?$/.exec(left);
      if (match?.[1]) anchors.push({ index, code: match[1] });
    }
    for (const [i, anchor] of anchors.entries()) {
      candidateCount++;
      const block = body.slice(anchor.index, anchors[i + 1]?.index ?? body.length);
      let rateRows = block.filter((line) =>
        line.cells.some(
          (c) => c.x >= 400 && (unit === "points" ? /^\d+$/.test(c.text) : euro.test(c.text)),
        ),
      );
      if (rateRows.length === 0) {
        unparsed.push({ code: anchor.code, page: pageIndex + 1 });
        continue;
      }
      parsedCount++;
      const firstRate = rateRows[0];
      const beforeRate = block
        .filter((line) => firstRate && line.y > firstRate.y)
        .map(lineText)
        .join(" ");
      const hasVariants = /Ordination:|Staffelregelung|Extensionsbehandlung/.test(beforeRate);
      // Unnumbered surcharges and fixed travel allowances are separate services.
      if (!hasVariants) rateRows = rateRows.slice(0, 1);
      const tableHeader = lines.slice(0, header + 1).at(-1);
      const sourceQuote = block.map(lineText).join("\n");
      let previousY = Number.POSITIVE_INFINITY;
      const sharedTitle = block
        .filter((line) => firstRate && line.y > firstRate.y)
        .map((line) =>
          line.cells
            .filter((c) => c.x >= 105)
            .map((c) => c.text)
            .join(" "),
        )
        .join(" ");
      for (const rateRow of rateRows) {
        const titleLines = block.filter((line) => line.y <= previousY && line.y >= rateRow.y);
        const title = normalize(
          titleLines
            .map((line) =>
              line.cells
                .flatMap((c) => {
                  if (c.x >= 105 && !(c.x >= 330 && (euro.test(c.text) || /^\d+$/.test(c.text))))
                    return [c.text];
                  if (c.x < 105 && c.text.startsWith("MAMSON ")) return [c.text.slice(7)];
                  return [];
                })
                .join(" "),
            )
            .join(" "),
        );
        let rates = rateRow.cells.filter(
          (c) => c.x >= 400 && (unit === "points" ? /^\d+$/.test(c.text) : euro.test(c.text)),
        );
        const precedingHeader =
          lines
            .filter(
              (line) =>
                line.y >= rateRow.y &&
                line.cells.some((c) => c.text === "Pos.Nr.:" || c.text === "Insgesamt"),
            )
            .at(-1) ?? tableHeader;
        const isRadiology = precedingHeader && lineText(precedingHeader).includes("Unk./€");
        if (precedingHeader && lineText(precedingHeader).includes("Insgesamt"))
          rates = rates.slice(-1);
        const amount =
          rates.reduce(
            (sum, cell) =>
              sum + (unit === "points" ? Number(cell.text) : Math.round(amountOf(cell.text) * 100)),
            0,
          ) / (unit === "points" ? 1 : 100);
        positions.push(
          FeePositionSchema.parse({
            code: anchor.code,
            title: normalize(
              `${previousY === Number.POSITIVE_INFINITY ? "" : sharedTitle} ${title}`,
            ),
            amount,
            unit,
            section,
            region: "Steiermark",
            asOf: "2025-01-01",
            page: pageIndex + 1,
            carrier: "ÖGK",
            tariffKind:
              /beinhaltet Grundbetrag/.test(title) ||
              (isRadiology && rates.length === 1 && !["MAMSON", "831", "820"].includes(anchor.code))
                ? "component"
                : "complete",
            sourceQuote,
          }),
        );
        previousY = rateRow.y - 1;
      }
    }
  }
  return result("styria", file, pages.length, positions, candidateCount, parsedCount, unparsed);
}

const commonCarriers = ["ÖGK / SVS-LW / Bundesheer", "SVS-GW", "KFA Wien"];
function dental(pages: TextLine[][], file: string): FeeSchedule {
  const positions: FeePosition[] = [];
  let candidateCount = 0;
  let parsedCount = 0;
  const unparsed: FeeSchedule["unparsed"] = [];
  for (const [pageIndex, lines] of pages.entries()) {
    const page = pageIndex + 1;
    const numbered = (page >= 5 && page <= 8) || page === 14 || page === 15;
    const prosthetic = page === 19 || page === 20 || page === 22;
    const orthodontic = page === 30 || page === 31 || page === 33;
    if (!numbered && !prosthetic && !orthodontic) continue;
    const header = lines.findIndex((l) => l.cells.some((c) => c.text === "Leistungsart"));
    if (header < 0) throw new Error(`Missing dental tariff header on page ${page}`);
    const following = lines.slice(header + 1);
    const explanation = following.findIndex((l) => lineText(l).startsWith("Erläuterungen"));
    const body = following
      .slice(0, explanation < 0 ? following.length : explanation)
      .filter((l) => l.y > 50);
    const section = numbered
      ? page < 14
        ? "Konservierend-chirurgische Zahnbehandlung"
        : "Konservierend-chirurgische Zahnbehandlung BVAEB"
      : page === 22
        ? "Kieferorthopädie – abnehmbare Geräte"
        : prosthetic
          ? "Prothetische Zahnbehandlung"
          : "Vertragskieferorthopädie";
    let roman = "";
    let romanTitle = "";
    const anchors: (Anchor & { prefix: string })[] = [];
    for (const [index, line] of body.entries()) {
      const first = line.cells[0];
      if (!first) continue;
      if (numbered && first.x < 70 && first.height > 8 && /^\d+[a-z]?$/.test(first.text)) {
        anchors.push({ index, code: first.text, prefix: "" });
      } else if (prosthetic) {
        if (first.x < 60 && /^[IVX]+\.$/.test(first.text)) {
          roman = first.text.slice(0, -1);
          romanTitle = line.cells
            .slice(1)
            .map((c) => c.text)
            .join(" ");
        }
        if (line.cells.some((c) => c.x > 390 && euro.test(c.text))) {
          const sub =
            first.x < 90 && /^(?:\d+\.|[a-z]\))$/.test(first.text)
              ? first.text.replace(/[.)]/g, "")
              : "";
          // Roman III on page 22 contains two unnumbered published subservices.
          const suffix =
            page === 22 && roman === "III"
              ? lineText(line).startsWith("Reparatur")
                ? ".Reparatur"
                : ""
              : "";
          anchors.push({
            index,
            code: `${roman}${sub ? `.${sub}` : ""}${suffix}`,
            prefix: romanTitle,
          });
        }
      } else if (orthodontic && line.cells.some((c) => c.x > 500 && euro.test(c.text))) {
        const abbreviation = line.cells.find((c) => c.x > 440 && c.x < 500)?.text;
        anchors.push({ index, code: abbreviation ?? "Behandlungspauschale", prefix: "" });
      }
    }
    for (const [i, anchor] of anchors.entries()) {
      candidateCount++;
      const block = body.slice(anchor.index, anchors[i + 1]?.index ?? body.length);
      const first = block[0];
      if (!first) continue;
      const columns =
        page === 14 || page === 15
          ? [{ min: 500, max: 570, carrier: "BVAEB" }]
          : orthodontic
            ? [{ min: 500, max: 570, carrier: "ÖGK / BVAEB / SVS" }]
            : commonCarriers.map((carrier, index) => ({
                min: 390 + index * 57,
                max: 447 + index * 57,
                carrier: prosthetic ? carrier.replace("ÖGK /", "ÖGK / BVAEB /") : carrier,
              }));
      const titleMax = numbered ? (page < 14 ? 330 : 450) : orthodontic ? 440 : 390;
      const titleMin = prosthetic ? 100 : 70;
      const titleParts: string[] = [];
      for (const line of block) {
        if (
          lineText(line).startsWith("Erläuterung") ||
          line.cells.some((c) => c.x < 60 && /^[IVX]+\.$/.test(c.text))
        )
          break;
        const part = line.cells
          .filter((c) => c.x >= titleMin && c.x < titleMax && c.height > 8)
          .map((c) => c.text)
          .join(" ");
        if (part) titleParts.push(part);
      }
      const title = normalize(`${anchor.prefix} ${titleParts.join(" ")}`);
      let parsed = false;
      for (const column of columns) {
        const cell = first.cells.find(
          (c) => c.x >= column.min && c.x < column.max && euro.test(c.text),
        );
        if (!cell) continue; // "n. a." is absence of a tariff, never zero euros.
        parsed = true;
        positions.push(
          FeePositionSchema.parse({
            code: anchor.code,
            title,
            amount: amountOf(cell.text),
            unit: "EUR",
            section,
            region: "Österreich",
            asOf: "2026-01-01",
            page,
            carrier: column.carrier,
            tariffKind: "complete",
            sourceQuote: block.map(lineText).join("\n"),
          }),
        );
      }
      if (parsed) parsedCount++;
      else unparsed.push({ code: anchor.code, page });
    }
  }
  return result("dental", file, pages.length, positions, candidateCount, parsedCount, unparsed);
}

function result(
  kind: ScheduleKind,
  file: string,
  pageCount: number,
  positions: FeePosition[],
  candidateCount: number,
  parsedCount: number,
  unparsed: FeeSchedule["unparsed"],
): FeeSchedule {
  if (candidateCount === 0) throw new Error(`No tariff positions found in ${file}`);
  return {
    kind,
    file,
    pageCount,
    positions,
    candidateCount,
    parsedCount,
    coverage: parsedCount / candidateCount,
    unparsed,
  };
}

export function parseFeePages(pages: TextLine[][], kind: ScheduleKind, file: string): FeeSchedule {
  const expectedPages = kind === "styria" ? 147 : 48;
  if (pages.length !== expectedPages)
    throw new Error(`Unsupported ${kind} schedule: expected ${expectedPages} pages`);
  const cover = pages
    .slice(0, kind === "styria" ? 1 : 3)
    .flat()
    .map(lineText)
    .join(" ");
  if (!(kind === "styria" ? /01\.01\.2025/ : /2026/).test(cover))
    throw new Error(`Unsupported ${kind} schedule date`);
  return kind === "styria" ? styria(pages, file) : dental(pages, file);
}
