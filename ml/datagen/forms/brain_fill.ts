/**
 * Bridge from the Python dataset runner to the product's form code (packages/brain/src/forms).
 *
 * Nothing here re-implements product logic: `templateSchema` normalizes the stored schema
 * (including provider/signature ownership shared by repeated AcroForm widgets), `proposeFields`
 * is the prefill policy (confirmed, unambiguous, quoted facts only; IBAN only from statements)
 * and `renderFormPdf` writes the product PDF (native AcroForm, or detected boxes added as
 * AcroForm fields on flat originals). The bridge adds only what the dataset needs on top: the
 * widget geometry of native fields and a flattened copy of the rendered output.
 *
 * Usage: bun ml/datagen/forms/brain_fill.ts <jobs.json>   (JSONL results on stdout)
 * jobs.json: { "templates": {uuid: {pdf, pages, status, fields}}, "jobs": [{id, template,
 *   facts, render: {filled?: path, flat?: path}}], "describe": [uuid...] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
const brain = resolve(root, "packages/brain");
const { proposeFields } = await import(`${brain}/src/forms/policy.ts`);
const { renderFormPdf } = await import(`${brain}/src/forms/output/render.ts`);
const { templateSchema } = await import(`${brain}/src/forms/schema.ts`);
const pdfLib = await import(Bun.resolveSync("pdf-lib", `${brain}/src`));
const { PDFDocument, PDFName, PDFRef } = pdfLib;

type Box = { page: number; x: number; y: number; width: number; height: number };
type Template = { pdf: string; pages: number; status: "auto" | "verified"; fields: unknown[] };
type Job = {
  id: string;
  template: string;
  facts: Record<string, unknown>[];
  render?: { filled?: string; flat?: string };
  approvalId?: string;
};

const spec = JSON.parse(readFileSync(process.argv[2] ?? "/dev/stdin", "utf8")) as {
  templates: Record<string, Template>;
  jobs: Job[];
  describe?: string[];
};

const originals = new Map<string, Uint8Array>();
const schemas = new Map<string, ReturnType<typeof templateSchema>>();

function original(uuid: string): Uint8Array {
  let bytes = originals.get(uuid);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(spec.templates[uuid].pdf));
    originals.set(uuid, bytes);
  }
  return bytes;
}

function schemaOf(uuid: string) {
  let schema = schemas.get(uuid);
  if (!schema) {
    const t = spec.templates[uuid];
    schema = templateSchema({
      id: uuid,
      status: t.status,
      pages: t.pages,
      schema: { fields: t.fields },
    } as never);
    schemas.set(uuid, schema);
  }
  return schema;
}

/** Native widget rectangle -> displayed top-left CropBox coordinates (inverse of render.ts). */
function displayed(page: InstanceType<typeof pdfLib.PDFPage>, r: { x: number; y: number; width: number; height: number }) {
  const crop = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const x0 = r.x - crop.x;
  const y0 = r.y - crop.y;
  if (rot === 0) return { x: x0, y: crop.height - y0 - r.height, width: r.width, height: r.height };
  if (rot === 90) return { x: y0, y: x0, width: r.height, height: r.width };
  if (rot === 180)
    return { x: crop.width - x0 - r.width, y: y0, width: r.width, height: r.height };
  return { x: crop.height - y0 - r.height, y: crop.width - x0 - r.width, width: r.height, height: r.width };
}

async function widgets(uuid: string): Promise<Record<string, Box[]>> {
  const document = await PDFDocument.load(original(uuid));
  const pages = document.getPages();
  const pageOfRef = new Map<string, number>();
  pages.forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef) pageOfRef.set(ref.toString(), index);
    }
  });
  const out: Record<string, Box[]> = {};
  for (const field of document.getForm().getFields()) {
    const boxes: Box[] = [];
    for (const widget of field.acroField.getWidgets()) {
      let index = -1;
      const pageRef = widget.dict.get(PDFName.of("P"));
      if (pageRef instanceof PDFRef) index = pages.findIndex((p) => p.ref === pageRef);
      if (index < 0) {
        const ref = document.context.getObjectRef(widget.dict);
        if (ref) index = pageOfRef.get(ref.toString()) ?? -1;
      }
      if (index < 0) continue;
      const rect = widget.getRectangle();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const box = displayed(pages[index], rect);
      boxes.push({ page: index + 1, ...roundBox(box) });
    }
    out[field.getName()] = boxes;
  }
  return out;
}

function roundBox(b: { x: number; y: number; width: number; height: number }) {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) };
}

async function pageSizes(uuid: string) {
  const document = await PDFDocument.load(original(uuid));
  return document.getPages().map((page) => {
    const crop = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    return rot % 180 === 0
      ? { width: crop.width, height: crop.height, rotation: rot }
      : { width: crop.height, height: crop.width, rotation: rot };
  });
}

function emit(row: unknown) {
  process.stdout.write(`${JSON.stringify(row)}\n`);
}

for (const uuid of spec.describe ?? []) {
  const schema = schemaOf(uuid);
  emit({ kind: "describe", template: uuid, fields: schema.fields, widgets: await widgets(uuid), pages: await pageSizes(uuid) });
}

for (const job of spec.jobs) {
  try {
    const schema = schemaOf(job.template);
    const facts = job.facts.map((fact) => ({ subjectId: "subject", confidence: 1, ...fact }));
    const { proposals, missingFields } = proposeFields(schema.fields, facts);
    const result: Record<string, unknown> = { kind: "job", id: job.id, proposals, missingFields };
    if (job.render?.filled || job.render?.flat) {
      // L3: the user confirmed the whole form, so every proposal is a confirmed value.
      const fields = Object.fromEntries(
        proposals.map((p: { fieldId: string; value: unknown; provenance: unknown }) => [
          p.fieldId,
          {
            value: p.value,
            provenance: p.provenance,
            state: "confirmed",
            approvalId: job.approvalId ?? "00000000-0000-4000-8000-000000000000",
          },
        ]),
      );
      try {
        const filled = await renderFormPdf(original(job.template), schema, fields);
        if (job.render.filled) writeFileSync(job.render.filled, filled);
        if (job.render.flat) {
          const document = await PDFDocument.load(filled);
          document.getForm().flatten();
          writeFileSync(job.render.flat, await document.save());
        }
      } catch (error) {
        // The product renderer failed (for example a glyph outside WinAnsi); keep the gold.
        result.renderError = String(error).slice(0, 300);
      }
    }
    emit(result);
  } catch (error) {
    emit({ kind: "job", id: job.id, error: String(error).slice(0, 300) });
  }
}
