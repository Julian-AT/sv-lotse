import type { caseSteps, cases, documents, facts, reminders, subjects } from "@lotse/db/schema";
import { PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import { CASE_FILE_CONFIG } from "../config/index.ts";
import { handoffCopy } from "./copy.ts";
import type { HandoffScope } from "./schema.ts";

export type HandoffData = {
  case: typeof cases.$inferSelect;
  subject: typeof subjects.$inferSelect;
  steps: (typeof caseSteps.$inferSelect)[];
  facts: (typeof facts.$inferSelect)[];
  documents: (typeof documents.$inferSelect)[];
  reminders: (typeof reminders.$inferSelect)[];
};

/** Preserve unsupported glyphs as explicit codepoints; the attached JSON keeps original Unicode. */
function printable(text: string, font: PDFFont): string {
  return Array.from(text.replace(/[\r\n\t]/g, " "))
    .map((character) => {
      try {
        font.encodeText(character);
        return character;
      } catch {
        return `[U+${character.codePointAt(0)?.toString(16).toUpperCase()}]`;
      }
    })
    .join("");
}

function linesFor(text: string, font: PDFFont): string[] {
  const { width, margin, fontSize } = CASE_FILE_CONFIG.pdf;
  const lines: string[] = [];
  let line = "";
  for (const word of printable(text, font).split(" ")) {
    if (line && font.widthOfTextAtSize(`${line} ${word}`, fontSize) > width - margin * 2) {
      lines.push(line);
      line = "";
    }
    for (const character of (line ? " " : "") + word) {
      if (font.widthOfTextAtSize(line + character, fontSize) > width - margin * 2) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  lines.push(line);
  return lines;
}

function sourceLines(source: Record<string, unknown>): string[] {
  const copy = handoffCopy.de;
  const lines = typeof source.quote === "string" ? [`${copy.source}: ${source.quote}`] : [];
  if (typeof source.sourceQuote === "string") lines.push(`${copy.source}: ${source.sourceQuote}`);
  const references = [source.documentId, source.page, source.turnId].filter(
    (value) => typeof value === "string" || typeof value === "number",
  );
  if (references.length) lines.push(`${copy.reference}: ${references.join(" / ")}`);
  return lines;
}

export async function renderHandoffPdf(
  data: HandoffData,
  scope: HandoffScope,
  generatedAt: Date,
): Promise<Uint8Array> {
  const copy = handoffCopy.de;
  const pdf = await PDFDocument.create();
  pdf.setTitle(copy.title);
  pdf.setLanguage("de-AT");
  pdf.setCreationDate(generatedAt);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height, margin, fontSize, lineHeight } = CASE_FILE_CONFIG.pdf;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const write = (text: string): void => {
    for (const line of linesFor(text, font)) {
      if (y < margin) {
        page = pdf.addPage([width, height]);
        y = height - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font });
      y -= lineHeight;
    }
  };
  const section = (title: string, lines: string[]): void => {
    write("");
    write(title);
    write("");
    for (const line of lines.length ? lines : [copy.empty]) write(line);
  };
  write(copy.title);
  write("");
  write(`${copy.subject}: ${data.subject.displayName}`);
  write(`${copy.goal}: ${data.case.confirmedGoal}`);
  write(`${copy.status}: ${copy.caseStatus[data.case.status]}`);
  write(`${copy.created}: ${generatedAt.toISOString()}`);
  write("");
  write(copy.notice);
  if (scope.includes("steps"))
    section(
      copy.steps,
      data.steps.map(
        (step) =>
          `${step.processStep} | ${copy.stepStatus[step.status]} | ${copy.owner[step.owner]} | ${step.dueAt ? `${copy.due}: ${step.dueAt.toISOString()}` : copy.noDueDate}`,
      ),
    );
  if (scope.includes("documents"))
    section(
      copy.documents,
      data.documents.map((document) => `${document.type} | ${document.id}`),
    );
  // Do not interpret or summarize fact values: only reproduce confirmed source quotes and locations.
  if (scope.includes("facts"))
    section(
      copy.facts,
      data.facts.flatMap((fact) => [`${fact.type} | ${fact.id}`, ...sourceLines(fact.source)]),
    );
  if (scope.includes("reminders"))
    section(
      copy.reminders,
      data.reminders.flatMap((reminder) => [
        `${typeof reminder.source.title === "string" ? reminder.source.title : copy.due}: ${reminder.dueAt.toISOString()}`,
        ...sourceLines(reminder.source),
      ]),
    );
  await pdf.attach(
    Buffer.from(
      JSON.stringify(
        {
          generatedAt,
          subject: {
            id: data.subject.id,
            displayName: data.subject.displayName,
            relationToUser: data.subject.relationToUser,
          },
          case: {
            id: data.case.id,
            subjectId: data.case.subjectId,
            confirmedGoal: data.case.confirmedGoal,
            status: data.case.status,
            lifeSituation: data.case.lifeSituation,
          },
          ...(scope.includes("steps") ? { steps: data.steps } : {}),
          ...(scope.includes("documents")
            ? {
                documents: data.documents.map((document) => ({
                  id: document.id,
                  type: document.type,
                  hash: document.hash,
                  createdAt: document.createdAt,
                })),
              }
            : {}),
          ...(scope.includes("facts") ? { facts: data.facts } : {}),
          ...(scope.includes("reminders") ? { reminders: data.reminders } : {}),
        },
        null,
        2,
      ),
    ),
    "case-summary.json",
    { mimeType: "application/json" },
  );
  return pdf.save();
}
