import { expect, test } from "vitest";
import { analyzeLetter } from "../../src/deadlines/letter.ts";

test("FR-D8 real extractor explains an administrative request with exact action and deadline quotes", async () => {
  // Synthetic administrative text avoids sending real personal data to the provider.
  const quote = "Bitte reichen Sie die fehlende Bestätigung bis 07.03.2027 ein.";
  const next = "Nach Erhalt prüfen wir Ihre Unterlagen.";
  const result = await analyzeLetter([
    { page: 1, text: `Amtliche Aufforderung\n${quote}\n${next}` },
  ]);
  expect(result.kind).toBe("administrative");
  expect(result.requiredActions.length).toBeGreaterThan(0);
  expect(result.deadlines).toContainEqual(
    expect.objectContaining({ dueAt: "2027-03-07", page: 1 }),
  );
  expect(result.deadlines.every((entry) => quote.includes(entry.quote))).toBe(true);
});

test("FR-K2 real extractor preserves relative periods without inferring a calendar date", async () => {
  const result = await analyzeLetter([
    {
      page: 1,
      text: "Amtliche Aufforderung. Bitte antworten Sie innerhalb von zwei Wochen nach Zustellung. Ein Zustelldatum ist nicht angegeben.",
    },
  ]);
  expect(result.kind).toBe("administrative");
  expect(result.deadlines.length).toBeGreaterThan(0);
  expect(result.deadlines.every((entry) => entry.dueAt === null)).toBe(true);
});
