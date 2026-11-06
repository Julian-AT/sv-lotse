import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { E7ExpectedSchema, E7InputSchema, loadE7 } from "../../src/e7/data.ts";

describe("E7 complete source-backed SV-Box gold", () => {
  it("covers every native PDF field once and three explicit personas per form", async () => {
    const data = await loadE7();
    expect(data.forms).toHaveLength(7);
    expect(data.cases).toHaveLength(21);
    let fields = 0;
    for (const form of data.forms) {
      const loading = getDocument({ data: Uint8Array.from(form.bytes), verbosity: 0 });
      try {
        const pdf = await loading.promise;
        const names = new Set<string>();
        for (let page = 1; page <= pdf.numPages; page++) {
          const annotations: unknown[] = await (await pdf.getPage(page)).getAnnotations();
          for (const annotation of annotations) {
            const widget = z
              .object({ subtype: z.literal("Widget"), fieldName: z.string() })
              .safeParse(annotation);
            if (widget.success) names.add(widget.data.fieldName);
          }
        }
        expect(form.pages).toBe(pdf.numPages);
        expect(form.schema.status).toBe("auto");
        expect(form.schema.fields.map((field) => field.acro_field).sort()).toEqual(
          [...names].sort(),
        );
        fields += names.size;
      } finally {
        await loading.destroy();
      }
    }
    expect(fields).toBe(416);
  });

  it("requires an explicit statement for IBAN gold and keeps signatures/provider fields empty", async () => {
    const data = await loadE7();
    let statementIbans = 0,
      withheldDocumentIbans = 0;
    for (const item of data.cases) {
      const input = E7InputSchema.parse(item.input);
      const gold = E7ExpectedSchema.parse(item.expected);
      const form = data.forms.find((entry) => entry.schema.id === input.form);
      expect(form).toBeDefined();
      for (const field of form?.schema.fields ?? []) {
        if (field.owner !== "applicant" || field.signature !== "none")
          expect(gold[field.id]).toBeNull();
        if (field.fact_type !== "bank.iban") continue;
        const stated = input.facts.find(
          (fact) => fact.type === field.fact_type && fact.source === "statement",
        );
        const document = input.facts.find(
          (fact) => fact.type === field.fact_type && fact.source === "document",
        );
        expect(gold[field.id]).toBe(stated?.value ?? null);
        if (stated) statementIbans++;
        if (document) withheldDocumentIbans++;
      }
    }
    expect(statementIbans).toBe(3);
    expect(withheldDocumentIbans).toBe(3);
  });
});
