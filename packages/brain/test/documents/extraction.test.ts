import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mocks.generate,
}));
vi.mock("../../src/models/index.ts", () => ({ modelFor: () => ({}) }));

import { extractDocumentStatements } from "../../src/documents/extraction.ts";
import type { DocumentPage } from "../../src/documents/schema.ts";
import { documentSections } from "../../src/documents/sections.ts";

function sourcePage(text: string, number = 1): DocumentPage {
  return {
    page: number,
    width: 600,
    height: 800,
    method: "text_layer",
    text,
    lines: text.split("\n").map((text, index) => ({
      text,
      bbox: { x: 0.1, y: 0.1 + index * 0.03, width: 0.8, height: 0.02 },
    })),
  };
}

const page = {
  page: 1,
  width: 600,
  height: 800,
  method: "text_layer" as const,
  text: "Ausstellungsdatum: 06.11.2026",
  lines: [
    { text: "Ausstellungsdatum: 06.11.2026", bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.02 } },
  ],
};
beforeEach(() => vi.resetAllMocks());

test("FR-D3 never returns a fabricated quote while preserving independently grounded facts", async () => {
  mocks.generate.mockResolvedValue({
    output: {
      statements: [
        { type: "administrative_fact", quote: page.text, candidateId: 0 },
        { type: "documented_recommendation", quote: "An invented recommendation", candidateId: 0 },
      ],
    },
  });
  const statements = await extractDocumentStatements([page]);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatchObject({
    type: "administrative_fact",
    quote: page.text,
    page: 1,
    bbox: { x: 0.1, y: 0.2 },
  });
  expect(statements[0]?.bbox.width).toBeCloseTo(0.4);
  expect(statements[0]?.bbox.height).toBeCloseTo(0.02);
});
test("FR-D3 does not invent any fact when no candidate can be grounded", async () => {
  mocks.generate.mockResolvedValue({
    output: {
      statements: [{ type: "administrative_fact", quote: "Invented institution", candidateId: 0 }],
    },
  });
  expect(await extractDocumentStatements([page])).toEqual([]);
});
test("FR-D3 isolates page context so later recommendations are reviewed independently", async () => {
  mocks.generate.mockResolvedValue({ output: { statements: [] } });
  expect(await extractDocumentStatements([page, { ...page, page: 2 }])).toEqual([]);
  expect(mocks.generate).toHaveBeenCalledTimes(2);
  const second = mocks.generate.mock.calls[1]?.[0] as { prompt: string };
  expect(JSON.parse(second.prompt).pages.map((item: { page: number }) => item.page)).toEqual([2]);
});

test("FR-D3 carries open-task ownership across pages without treating a responsibility cell as a heading", async () => {
  // A constructed continuation layout based on the real letter's open-task table.
  const pages = [
    sourcePage(
      "9. Offene Aufgaben nach der Entlassung\nAufgabe Zuständigkeit / nächste Schritte\nEin offener Verwaltungshinweis.",
    ),
    sourcePage(
      "Pflegegeldanspruch prüfen\nSozialberatung\n10. Zusammenfassende Beurteilung\nKlinischer Text.",
      2,
    ),
  ];
  mocks.generate.mockResolvedValueOnce({ output: { statements: [] } }).mockResolvedValueOnce({
    output: {
      statements: [
        {
          type: "administrative_fact",
          quote: null,
          candidateId: 0,
        },
      ],
    },
  });
  const statements = await extractDocumentStatements(pages);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatchObject({ page: 2, bbox: { x: 0.1, y: 0.1 } });
  expect(statements[0]?.bbox.height).toBeCloseTo(0.05);
  const request = mocks.generate.mock.calls[1]?.[0] as { prompt: string };
  expect(JSON.parse(request.prompt).pages[0].candidates).toEqual([
    {
      candidateId: 0,
      kind: "task_row",
      section: "tasks",
      heading: "9. Offene Aufgaben nach der Entlassung",
      text: "Pflegegeldanspruch prüfen\nSozialberatung",
    },
  ]);
});

test("FR-D3 withholds clinical sections and rejects clinical candidates even when quoted verbatim", async () => {
  const clinical = "Hauptdiagnose: klinischer Befund.";
  const pages = [
    sourcePage(
      `Ausgestellt: 06.11.2026\n2. Aufnahmediagnosen und medizinische Vorgeschichte\n${clinical}`,
    ),
    sourcePage("Fortsetzung des klinischen Befunds.", 2),
    sourcePage("5. Entlassungsmedikation\nEin dokumentierter Arzneimittelname", 3),
  ];
  mocks.generate.mockResolvedValue({
    output: {
      statements: [
        {
          type: "administrative_fact",
          quote: clinical,
          candidateId: 0,
        },
      ],
    },
  });
  expect(await extractDocumentStatements(pages)).toEqual([
    expect.objectContaining({
      quote: "Ausgestellt: 06.11.2026",
      type: "administrative_fact",
      page: 1,
    }),
  ]);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  const request = mocks.generate.mock.calls[0]?.[0] as { prompt: string };
  expect(request.prompt).not.toContain(clinical);
  expect(documentSections(pages)[1]?.sections[0]?.kind).toBe("clinical");
  expect(documentSections(pages)[2]?.sections[0]?.kind).toBe("medication");
});

test("FR-D3 keeps rehabilitation application preparation after a goals subheading in source context", () => {
  const page = sourcePage(
    "7. Empfehlung zur medizinischen Rehabilitation\nMögliche Rehabilitationsziele:\nKlinischer Text.\nDer Antrag soll vorbereitet werden.",
  );
  expect(documentSections([page])[0]?.sections).toEqual([
    {
      kind: "rehabilitation",
      heading: "7. Empfehlung zur medizinischen Rehabilitation",
      start: 0,
      end: page.text.length,
    },
  ]);
});

test("FR-D3 locates the selected occurrence when the same sentence is printed twice", async () => {
  const text = "Eine kurze Verwaltungsangabe.";
  const page = sourcePage(`${text}\n${text}`);
  mocks.generate.mockResolvedValue({
    output: {
      statements: [
        {
          candidateId: 1,
          quote: null,
          type: "administrative_fact",
        },
      ],
    },
  });
  const statements = await extractDocumentStatements([page]);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatchObject({ quote: text, bbox: { x: 0.1, y: 0.13, width: 0.8 } });
  expect(statements[0]?.bbox.height).toBeCloseTo(0.02);
});

test("FR-D3 retains section context when only a continuation page is requested", async () => {
  const pages = [
    sourcePage("9. Offene Aufgaben nach der Entlassung\nAufgabe Zuständigkeit / nächste Schritte"),
    sourcePage("Unterlagen vorbereiten\nSozialberatung", 2),
  ];
  mocks.generate.mockResolvedValue({
    output: {
      statements: [
        {
          candidateId: 0,
          quote: null,
          type: "administrative_fact",
        },
      ],
    },
  });
  const statements = await extractDocumentStatements(pages, undefined, { from: 2, to: 2 });
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatchObject({ quote: pages[1]?.text, page: 2 });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  const request = mocks.generate.mock.calls[0]?.[0] as { prompt: string };
  expect(JSON.parse(request.prompt).pages[0].candidates[0].heading).toBe(
    "9. Offene Aufgaben nach der Entlassung",
  );
});

test("FR-D3 never exposes a whole medication table row when no medicine name was selected", async () => {
  const page = sourcePage("5. Entlassungsmedikation\nBehandlung und ärztliche Anweisungen");
  mocks.generate.mockResolvedValue({
    output: {
      statements: [
        {
          candidateId: 0,
          quote: null,
          type: "administrative_fact",
        },
      ],
    },
  });
  expect(await extractDocumentStatements([page])).toEqual([]);
});

test("FR-D3 excludes inline findings while retaining independent administrative fields", async () => {
  const page = sourcePage("Befund: Dokumentierter klinischer Text.\nFallnummer: TEST-42");
  const statements = await extractDocumentStatements([page]);
  expect(statements).toEqual([
    expect.objectContaining({ quote: "Fallnummer: TEST-42", type: "administrative_fact" }),
  ]);
  expect(mocks.generate).not.toHaveBeenCalled();
});

test("FR-D3 never treats a clinical sentence mentioning a hospital as an issuing institution", async () => {
  const page = sourcePage(
    "Die Patientin wurde wegen eines Befunds in der Klinik aufgenommen.\nFallnummer: TEST-43",
  );
  mocks.generate.mockResolvedValue({ output: { statements: [] } });
  expect(await extractDocumentStatements([page])).toEqual([
    expect.objectContaining({ quote: "Fallnummer: TEST-43", type: "administrative_fact" }),
  ]);
});

test("FR-D3 rejects unnamed medicine groups and clinical column text despite exact grounding", async () => {
  const page = sourcePage(
    "5. Entlassungsmedikation\nWeitere onkologische Medikamente\nBehandlung nach ärztlicher Verordnung",
  );
  mocks.generate.mockResolvedValue({
    output: {
      statements: [
        { candidateId: 0, quote: "Weitere onkologische Medikamente", type: "administrative_fact" },
        {
          candidateId: 0,
          quote: "Behandlung nach ärztlicher Verordnung",
          type: "administrative_fact",
        },
      ],
    },
  });
  expect(await extractDocumentStatements([page])).toEqual([]);
});

test("FR-D3 withholds treatment-continuation instructions while retaining follow-up attendance", async () => {
  const page = sourcePage(
    "6.1 Onkologische Behandlung\nFortführung der geplanten ambulanten Bestrahlung gemäß onkologischem Therapieplan.\nRegelmäßige Vorstellung in der onkologischen Ambulanz.",
  );
  expect(await extractDocumentStatements([page])).toEqual([
    expect.objectContaining({
      quote: "Regelmäßige Vorstellung in der onkologischen Ambulanz.",
      type: "administrative_fact",
    }),
  ]);
  expect(mocks.generate).not.toHaveBeenCalled();
});
