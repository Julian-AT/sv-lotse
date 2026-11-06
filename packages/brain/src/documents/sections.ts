import {
  type DocumentSectionKind,
  documentExtractionPolicy,
} from "@lotse/knowledge/document-policy";
import type { DocumentPage } from "./schema.ts";

export interface DocumentSection {
  kind: DocumentSectionKind | "unclassified";
  heading: string | null;
  start: number;
  end: number;
}
export interface SectionedPage {
  page: DocumentPage;
  sections: DocumentSection[];
}
const headings = documentExtractionPolicy.sections.map(({ kind, pattern }) => ({
  kind,
  expression: new RegExp(pattern, "iu"),
}));
const tableCellHeading = new RegExp(documentExtractionPolicy.table_cell_heading_pattern, "iu");

/** Carry section ownership across page breaks, without borrowing quotes from another page. */
export function documentSections(pages: readonly DocumentPage[]): SectionedPage[] {
  let kind: DocumentSection["kind"] = "unclassified";
  let heading: string | null = null;
  return pages.map((page) => {
    const sections: DocumentSection[] = [];
    let start = 0;
    let offset = 0;
    for (const line of page.lines) {
      const match = headings.find(({ expression }) => expression.test(line.text.trim()));
      // A wrapped responsibility cell can itself name a counselling service.
      // It must not end an open-task table's ownership.
      if (
        match &&
        !((kind === "tasks" || kind === "medication") && tableCellHeading.test(line.text.trim()))
      ) {
        if (offset > start) sections.push({ kind, heading, start, end: offset - 1 });
        kind = match.kind;
        heading = line.text;
        start = offset;
      }
      offset += line.text.length + 1;
    }
    if (start < page.text.length) sections.push({ kind, heading, start, end: page.text.length });
    return { page, sections };
  });
}
