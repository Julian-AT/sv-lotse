import { expect, test } from "vitest";
import { chunkMarkdown } from "../../src/ingest/chunk.ts";
import { normalizeHtml } from "../../src/ingest/normalize.ts";

// Constructed layouts reproduce formatting and boundary failures on live official pages.
test("searchable chunks preserve rendered quotes across links, emphasis and list items", () => {
  const page = normalizeHtml(
    '<main><h1>Information</h1><p>Ab dem <strong>1. Oktober 2026</strong> gilt das Programm.</p><ul><li>Bringen Sie Ihre <a href="/card">e-card</a></li><li>einen Lichtbildausweis</li></ul><p>Kursleiter*innen begleiten den Kurs.</p></main>',
    "https://www.gesundheit.gv.at/",
    { searchable: true },
  );
  const text = chunkMarkdown(page.markdown)
    .map((chunk) => chunk.text)
    .join(" ")
    .replace(/\s+/gu, " ");
  expect(text).toContain("Ab dem 1. Oktober 2026 gilt das Programm.");
  expect(text).toContain("Bringen Sie Ihre e-card einen Lichtbildausweis");
  expect(text).toContain("Kursleiter*innen begleiten den Kurs.");
  expect(text).not.toContain("](");
});

test("chunk overlap keeps a complete passage spanning a long paragraph split", () => {
  const passage = "Der Antrag muss gemeinsam mit dem Zahlungsnachweis eingereicht werden. "
    .repeat(5)
    .trim();
  const markdown = `# Information\n\n${"Information. ".repeat(235)}${passage} ${"Weitere Information. ".repeat(100)}`;
  const chunks = chunkMarkdown(markdown);
  expect(chunks.some((chunk) => chunk.text.includes(passage))).toBe(true);
  expect(chunks.every((chunk) => chunk.text.length <= 3200)).toBe(true);
});

test("overlap never transfers content between heading sections", () => {
  const chunks = chunkMarkdown(
    `# First\n\n${"First content. ".repeat(250)}\n\n# Second\n\nSecond content.`,
  );
  expect(
    chunks
      .filter((chunk) => chunk.heading_path[0] === "Second")
      .every((chunk) => !chunk.text.includes("First content")),
  ).toBe(true);
});
