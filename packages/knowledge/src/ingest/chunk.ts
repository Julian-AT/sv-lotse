import { INGESTION_CONFIG } from "../config.ts";

export interface MarkdownChunk {
  text: string;
  heading_path: string[];
  size_exception: "section_tail" | "oversized_table" | null;
}

// Approximation: 4 Unicode characters per token; target 400–800 tokens.
// Short heading sections remain short; tables are indivisible even above 800.
const MIN = INGESTION_CONFIG.chunkMinCharacters;
const MAX = INGESTION_CONFIG.chunkMaxCharacters;

export function chunkMarkdown(markdown: string): MarkdownChunk[] {
  const sections: { headings: { level: number; title: string }[]; blocks: string[] }[] = [];
  let headings: { level: number; title: string }[] = [];
  let blocks: string[] = [];
  const endSection = () => {
    if (blocks.length) sections.push({ headings: [...headings], blocks });
    blocks = [];
  };
  let fenced = false;
  let fenceMarker = "";
  let current: string[] = [];
  const endBlock = () => {
    if (current.length) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of markdown.split("\n")) {
    const fence = /^(?:`{3,}|~{3,})/.exec(line)?.[0];
    if (fence) {
      if (!fenced) {
        fenced = true;
        fenceMarker = fence[0] ?? "`";
      } else if (fence.startsWith(fenceMarker)) fenced = false;
    }
    const heading = !fenced ? /^(#{1,6})\s+(.+)$/.exec(line) : null;
    if (heading) {
      endBlock();
      endSection();
      const level = heading[1]?.length ?? 1;
      headings = headings.filter((parent) => parent.level < level);
      headings.push({ level, title: heading[2] ?? "" });
    } else if (!line.trim() && !fenced) endBlock();
    else current.push(line);
  }
  endBlock();
  endSection();
  const result: MarkdownChunk[] = [];
  for (const section of sections) {
    const prefix = section.headings
      .map((heading) => `${"#".repeat(heading.level)} ${heading.title}`)
      .join("\n\n");
    const capacity = Math.max(1, MAX - prefix.length - 2);
    let pending = "";
    const emit = (oversized = false) => {
      if (!pending) return;
      const text = [prefix, pending].filter(Boolean).join("\n\n");
      result.push({
        text,
        heading_path: section.headings.map((heading) => heading.title),
        size_exception: oversized ? "oversized_table" : text.length < MIN ? "section_tail" : null,
      });
      pending = "";
    };
    for (const block of section.blocks) {
      const table = /^\|/m.test(block) && /\n\|\s*:?-{3,}/.test(block);
      if (table) {
        emit();
        pending = block;
        emit(block.length > capacity);
        continue;
      }
      const pieces: string[] = [];
      let rest = block;
      while (rest.length > capacity) {
        const whitespace = rest.lastIndexOf(" ", capacity);
        const cut = whitespace >= capacity / 2 ? whitespace : capacity;
        pieces.push(rest.slice(0, cut));
        // Start at a word boundary before the cut so sentences spanning it survive.
        const overlap = Math.min(INGESTION_CONFIG.chunkOverlapCharacters, Math.floor(capacity / 3));
        const start = rest.indexOf(" ", Math.max(1, cut - overlap));
        rest = rest.slice(start > 0 && start < cut ? start + 1 : cut).trimStart();
      }
      if (rest) pieces.push(rest);
      for (const piece of pieces) {
        if (pending && pending.length + 2 + piece.length > capacity) {
          const tail = pending.slice(-INGESTION_CONFIG.chunkOverlapCharacters);
          const boundary = tail.indexOf(" ");
          const overlap = boundary >= 0 ? tail.slice(boundary + 1) : "";
          emit();
          if (overlap.length + 2 + piece.length <= capacity) pending = overlap;
        }
        pending = pending ? `${pending}\n\n${piece}` : piece;
      }
    }
    emit();
  }
  return result;
}
