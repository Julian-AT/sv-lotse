export interface MarkdownChunk {
  text: string;
  heading_path: string[];
  size_exception: "section_tail" | "oversized_table" | null;
}

// Approximation: 4 Unicode characters per token; target 400–800 tokens.
// Short heading sections remain short; tables are indivisible even above 800.
const MIN = 1600;
const MAX = 3200;

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
      if (table && block.length > capacity) {
        emit();
        pending = block;
        emit(true);
        continue;
      }
      const pieces: string[] = [];
      let rest = block;
      while (rest.length > capacity) {
        const whitespace = rest.lastIndexOf(" ", capacity);
        const cut = whitespace >= capacity / 2 ? whitespace : capacity;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      if (rest) pieces.push(rest);
      for (const piece of pieces) {
        if (pending && pending.length + 2 + piece.length > capacity) emit();
        pending = pending ? `${pending}\n\n${piece}` : piece;
      }
    }
    emit();
  }
  return result;
}
