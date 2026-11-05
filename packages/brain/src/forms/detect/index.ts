import { z } from "zod";
import { deduplicateCandidates, textCandidates, vectorCandidates } from "./candidates.ts";
import { insidePage, type Matrix, overlap, transformBox } from "./geometry.ts";
import { withPdf } from "./pdf.ts";
import {
  type DetectedField,
  DraftFormSchema,
  FieldDetectionError,
  type FieldOwner,
} from "./schema.ts";
import { associateLabel, fieldOwner, inferType, sectionHeaders, textRuns } from "./text.ts";
import { detectVisionFields, type PageRenderer, renderPageImage } from "./vision.ts";

const OptionsSchema = z.object({
  mode: z.enum(["auto", "acroform"]).default("auto"),
  vision: z.enum(["auto", "disabled", "always"]).default("auto"),
  signal: z.instanceof(AbortSignal).optional(),
  renderPage: z.custom<PageRenderer>((value) => typeof value === "function").optional(),
});
export type DetectOptions = z.input<typeof OptionsSchema>;
const WidgetSchema = z.object({
  subtype: z.literal("Widget"),
  id: z.string(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  fieldType: z.string(),
  fieldName: z.string().optional(),
  alternativeText: z.string().optional(),
  radioButton: z.boolean().optional(),
  pushButton: z.boolean().optional(),
});

/** Detect a reviewable draft; no registry, facts, form values or approval state are written. */
export async function detectFields(pdfBytes: Uint8Array, options: DetectOptions = {}) {
  const settings = OptionsSchema.parse(options);
  return withPdf(pdfBytes, settings.signal, async (document) => {
    const fields: DetectedField[] = [];
    const pages: { page: number; width: number; height: number }[] = [];
    let owner: FieldOwner = "applicant";
    for (let number = 1; number <= document.numPages; number++) {
      settings.signal?.throwIfAborted();
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const matrix = viewport.transform as Matrix;
      pages.push({ page: number, width: viewport.width, height: viewport.height });
      try {
        const runs = textRuns(await page.getTextContent(), matrix, number);
        const headers = sectionHeaders(runs);
        // A provider heading near the page top also owns identifiers in its running header.
        const firstHeader = headers[0];
        const initialOwner: FieldOwner =
          firstHeader && firstHeader.y < 80 ? firstHeader.owner : owner;
        const annotations: unknown[] = await page.getAnnotations();
        const widgets: DetectedField[] = [];
        for (const raw of annotations) {
          const parsed = WidgetSchema.safeParse(raw);
          if (!parsed.success) continue;
          const widget = parsed.data;
          const box = transformBox(widget.rect, matrix, number);
          if (
            box.x < 0 ||
            box.y < 0 ||
            box.x + box.width > viewport.width ||
            box.y + box.height > viewport.height
          )
            throw new FieldDetectionError("invalid_pdf");
          const type =
            widget.fieldType === "Btn"
              ? widget.radioButton
                ? "choice"
                : widget.pushButton
                  ? "text"
                  : "checkbox"
              : widget.fieldType === "Ch"
                ? "choice"
                : widget.fieldType === "Sig"
                  ? "signature"
                  : "text";
          const label =
            associateLabel(box, runs, type === "checkbox") ||
            widget.alternativeText?.trim() ||
            widget.fieldName;
          const fieldOwnerValue = fieldOwner(box.y, headers, initialOwner);
          widgets.push({
            id: `p${number}-widget-${widget.id}`,
            label_de: label || `Feld ${number}.${widgets.length + 1}`,
            type,
            box,
            ...(widget.fieldName !== undefined ? { acro_field: widget.fieldName } : {}),
            owner: fieldOwnerValue,
            signature: type === "signature" && fieldOwnerValue === "applicant" ? "subject" : "none",
            confidence: 0.99,
            method: "acroform",
          });
        }
        fields.push(...widgets);
        if (settings.mode === "acroform") {
          owner = headers.at(-1)?.owner ?? initialOwner;
          continue;
        }
        if (settings.vision === "always" || (runs.length === 0 && settings.vision !== "disabled")) {
          const image = settings.renderPage
            ? await settings.renderPage(pdfBytes, number, { signal: settings.signal })
            : await renderPageImage(document, page, settings.signal);
          const detected = await detectVisionFields(image, initialOwner, settings.signal);
          for (const [index, field] of detected.fields.entries()) {
            const box = {
              page: number,
              x: field.box.x * viewport.width,
              y: field.box.y * viewport.height,
              width: field.box.width * viewport.width,
              height: field.box.height * viewport.height,
            };
            const matchingWidgets = widgets.filter((widget) => overlap(widget.box, box) >= 0.5);
            for (const widget of matchingWidgets) {
              widget.owner = field.owner;
              widget.signature =
                widget.type === "signature" && widget.owner === "applicant" ? "subject" : "none";
            }
            if (matchingWidgets.length > 0) continue;
            fields.push({
              ...field,
              box,
              id: `p${number}-vision-${index + 1}`,
              signature:
                field.type === "signature" && field.owner === "applicant" ? "subject" : "none",
              confidence: 0.6,
              method: "vision",
            });
          }
          owner = detected.lastOwner;
        } else {
          const candidates = deduplicateCandidates([
            ...vectorCandidates(await page.getOperatorList(), matrix, number),
            ...textCandidates(runs),
          ]);
          for (const [index, candidate] of candidates.entries()) {
            const box = insidePage(candidate.box, viewport.width, viewport.height);
            if (
              !box ||
              box.width > viewport.width * 0.95 ||
              widgets.some((widget) => overlap(widget.box, box) >= 0.5)
            )
              continue;
            if (
              headers.some(
                (header) =>
                  header.y >= box.y - 2 &&
                  header.y < box.y + box.height &&
                  header.box.x >= box.x &&
                  header.box.x < box.x + box.width,
              )
            )
              continue;
            const label = candidate.label || associateLabel(box, runs, candidate.checkbox);
            if (!label) continue;
            const type = inferType(label, candidate.checkbox);
            const fieldOwnerValue = fieldOwner(box.y, headers, initialOwner);
            fields.push({
              id: `p${number}-detected-${index + 1}`,
              label_de: label,
              box,
              type,
              owner: fieldOwnerValue,
              signature:
                type === "signature" && fieldOwnerValue === "applicant" ? "subject" : "none",
              confidence: candidate.confidence,
              method: candidate.method,
            });
          }
          owner = headers.at(-1)?.owner ?? initialOwner;
        }
        if (fields.length > 10_000) throw new FieldDetectionError("limits_exceeded");
      } finally {
        page.cleanup();
      }
    }
    settings.signal?.throwIfAborted();
    return DraftFormSchema.parse({
      status: "auto",
      pages,
      fields: fields.sort(
        (a, b) => a.box.page - b.box.page || a.box.y - b.box.y || a.box.x - b.box.x,
      ),
    });
  });
}

export type { DetectedField, DraftForm, FieldBox, FieldOwner, FieldType } from "./schema.ts";
export {
  DetectedFieldSchema,
  DraftFormSchema,
  FieldBoxSchema,
  FieldDetectionError,
} from "./schema.ts";
