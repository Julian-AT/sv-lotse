import type {
  PDFDocumentProxy,
  PDFOperatorList,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api.js";
import { z } from "zod";
import { directLabel, labelLines, nearbyLabel } from "./association.ts";
import {
  type Candidate,
  deduplicateCandidates,
  mergeCombSegments,
  textCandidates,
  vectorCandidates,
} from "./candidates.ts";
import { DETECTION_CONFIG } from "./config.ts";
import { fontMetrics } from "./fonts.ts";
import { insidePage, inverse, type Matrix, multiply, overlap, transformBox } from "./geometry.ts";
import { answerCandidate, containsBox, mergeCaptionCells, splitLabelledCells } from "./grid.ts";
import { columnLabel, contextualLabel, ignoredLabel } from "./labels.ts";
import { withPdf } from "./pdf.ts";
import { printedHeader, splitRepeatedRows } from "./rows.ts";
import { needsVision } from "./scan.ts";
import {
  type DetectedField,
  type DraftForm,
  DraftFormSchema,
  type FieldBox,
  FieldDetectionError,
  type FieldOwner,
  type FieldType,
} from "./schema.ts";
import {
  associateLabel,
  fieldOwner,
  inferType,
  sectionHeaders,
  type TextRun,
  textOrientation,
  textRuns,
} from "./text.ts";
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

interface PageLayout {
  page: number;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  matrix: Matrix;
  toDisplay: Matrix;
  fromDisplay: Matrix;
  runs: TextRun[];
  headers: ReturnType<typeof sectionHeaders>;
  initialOwner: FieldOwner;
  operators: PDFOperatorList;
}
interface PageDetection {
  fields: DetectedField[];
  owner: FieldOwner;
}
type Settings = z.output<typeof OptionsSchema>;

/** Detect a reviewable draft; no registry, facts, form values or approval state are written. */
export async function detectFields(
  pdfBytes: Uint8Array,
  options: DetectOptions = {},
): Promise<DraftForm> {
  const settings = OptionsSchema.parse(options);
  return withPdf(pdfBytes, settings.signal, async (document) => {
    const fields: DetectedField[] = [];
    const pages: DraftForm["pages"] = [];
    let owner: FieldOwner = "applicant";
    for (let number = 1; number <= document.numPages; number++) {
      settings.signal?.throwIfAborted();
      const page = await document.getPage(number);
      try {
        const layout = await pageLayout(page, owner);
        pages.push({ page: number, width: layout.displayWidth, height: layout.displayHeight });
        const detected = await detectPage(document, page, pdfBytes, settings, layout);
        fields.push(...displayFields(detected.fields, layout));
        owner = detected.owner;
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

async function pageLayout(page: PDFPageProxy, owner: FieldOwner): Promise<PageLayout> {
  const displayed = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const angle = textOrientation(content, displayed.transform as Matrix);
  const viewport = page.getViewport({ scale: 1, rotation: (page.rotate - angle + 360) % 360 });
  const matrix = viewport.transform as Matrix;
  const toDisplay = multiply(displayed.transform as Matrix, inverse(matrix));
  const operators = await page.getOperatorList();
  const runs = textRuns(content, matrix, page.pageNumber, fontMetrics(page, operators));
  const headers = sectionHeaders(runs);
  const firstHeader = headers[0];
  return {
    page: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    displayWidth: displayed.width,
    displayHeight: displayed.height,
    matrix,
    toDisplay,
    fromDisplay: inverse(toDisplay),
    operators,
    runs,
    headers,
    initialOwner: firstHeader && firstHeader.y < 80 ? firstHeader.owner : owner,
  };
}

async function detectPage(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
  pdfBytes: Uint8Array,
  settings: Settings,
  layout: PageLayout,
): Promise<PageDetection> {
  const widgets = readWidgets(await page.getAnnotations(), layout);
  const owner = layout.headers.at(-1)?.owner ?? layout.initialOwner;
  if (settings.mode === "acroform") return { fields: widgets, owner };
  const vectorFields = readVectorFields(layout, widgets);
  if (
    settings.vision === "always" ||
    (settings.vision !== "disabled" &&
      needsVision(
        layout.runs,
        layout.operators,
        layout.matrix,
        layout.width * layout.height,
        vectorFields.length,
      ))
  ) {
    const image = settings.renderPage
      ? await settings.renderPage(pdfBytes, layout.page, { signal: settings.signal })
      : await renderPageImage(document, page, settings.signal);
    const detected = await detectVisionFields(image, layout.initialOwner, settings.signal);
    const fields = [...vectorFields];
    for (const [index, field] of detected.fields.entries()) {
      const candidate = visionField(field, index, layout, widgets, fields);
      if (candidate) fields.push(candidate);
    }
    return { fields, owner: detected.lastOwner };
  }
  return { fields: vectorFields, owner };
}

function displayFields(fields: readonly DetectedField[], layout: PageLayout): DetectedField[] {
  return fields.map((field) => {
    const box = field.box;
    return {
      ...field,
      box: transformBox(
        [box.x, box.y, box.x + box.width, box.y + box.height],
        layout.toDisplay,
        layout.page,
      ),
    };
  });
}

function widgetType(widget: z.infer<typeof WidgetSchema>): FieldType {
  if (widget.fieldType === "Btn")
    return widget.radioButton ? "choice" : widget.pushButton ? "text" : "checkbox";
  if (widget.fieldType === "Ch") return "choice";
  return widget.fieldType === "Sig" ? "signature" : "text";
}

function ownerAt(box: FieldBox, layout: PageLayout): FieldOwner {
  return fieldOwner(
    box.y + Math.min(box.height, DETECTION_CONFIG.labelRowHeight),
    layout.headers,
    layout.initialOwner,
    box,
    layout.width,
  );
}

function readWidgets(annotations: readonly unknown[], layout: PageLayout): DetectedField[] {
  const widgets: DetectedField[] = [];
  for (const raw of annotations) {
    const parsed = WidgetSchema.safeParse(raw);
    if (!parsed.success) continue;
    const widget = parsed.data;
    const box = transformBox(widget.rect, layout.matrix, layout.page);
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > layout.width ||
      box.y + box.height > layout.height
    )
      throw new FieldDetectionError("invalid_pdf");
    const type = widgetType(widget);
    const label =
      associateLabel(box, layout.runs, type === "checkbox") ||
      widget.alternativeText?.trim() ||
      widget.fieldName;
    const owner = ownerAt(box, layout);
    widgets.push({
      id: `p${layout.page}-widget-${widget.id}`,
      label_de: label || `Feld ${layout.page}.${widgets.length + 1}`,
      type,
      box,
      ...(widget.fieldName !== undefined ? { acro_field: widget.fieldName } : {}),
      owner,
      signature: type === "signature" && owner === "applicant" ? "subject" : "none",
      confidence: 0.99,
      method: "acroform",
    });
  }
  return widgets;
}

type VisionField = Awaited<ReturnType<typeof detectVisionFields>>["fields"][number];
function visionField(
  field: VisionField,
  index: number,
  layout: PageLayout,
  widgets: readonly DetectedField[],
  fields: readonly DetectedField[],
): DetectedField | undefined {
  const box = transformBox(
    [
      field.box.x * layout.displayWidth,
      field.box.y * layout.displayHeight,
      (field.box.x + field.box.width) * layout.displayWidth,
      (field.box.y + field.box.height) * layout.displayHeight,
    ],
    layout.fromDisplay,
    layout.page,
  );
  const matching = [...widgets, ...fields].filter((widget) => overlap(widget.box, box) >= 0.5);
  for (const widget of matching) {
    if (field.owner !== "applicant" || widget.owner === "applicant") widget.owner = field.owner;
    widget.signature =
      widget.type === "signature" && widget.owner === "applicant" ? "subject" : "none";
  }
  if (
    matching.length > 0 ||
    fields.some((existing) => overlap(existing.box, box) >= DETECTION_CONFIG.duplicateIou)
  )
    return undefined;
  return {
    ...field,
    box,
    id: `p${layout.page}-vision-${index + 1}`,
    signature: field.type === "signature" && field.owner === "applicant" ? "subject" : "none",
    confidence: 0.6,
    method: "vision",
  };
}

function readVectorFields(layout: PageLayout, widgets: readonly DetectedField[]): DetectedField[] {
  const candidates = splitLabelledCells(
    splitRepeatedRows(
      mergeCaptionCells(
        mergeCombSegments(
          deduplicateCandidates([
            ...vectorCandidates(layout.operators, layout.matrix, layout.page),
            ...textCandidates(layout.runs),
          ]),
        ),
        layout.runs,
      ),
      layout.runs,
    ),
    layout.runs,
  );
  const labels = labelLines(layout.runs, candidates);
  const fields = [...widgets];
  for (const [index, raw] of candidates.entries()) {
    if (printedHeader(raw, candidates, layout.runs)) continue;
    const candidate = answerCandidate(raw, layout.runs);
    if (!candidate) continue;
    const field = vectorField(candidate, index, layout, candidates, fields, labels);
    if (field) fields.push(field);
  }
  return fields;
}

function excludedCandidate(
  candidate: Candidate,
  box: FieldBox,
  layout: PageLayout,
  candidates: readonly Candidate[],
  fields: readonly DetectedField[],
): boolean {
  if (
    !candidate.checkbox &&
    candidates.some((other) => other.checkbox && containsBox(candidate.box, other.box))
  )
    return true;
  if (box.width > layout.width * 0.95) return true;
  if (
    !candidate.checkbox &&
    fields.some((field) => field.type !== "checkbox" && containsBox(field.box, box))
  )
    return true;
  if (
    fields.some(
      (existing) =>
        overlap(existing.box, box) >=
        (existing.method === "acroform" ? 0.5 : DETECTION_CONFIG.duplicateIou),
    )
  )
    return true;
  return layout.headers.some(
    (header) =>
      header.y >= box.y - 2 &&
      header.y < box.y + box.height &&
      header.box.x >= box.x &&
      header.box.x < box.x + box.width,
  );
}

function vectorField(
  candidate: Candidate,
  index: number,
  layout: PageLayout,
  candidates: readonly Candidate[],
  fields: readonly DetectedField[],
  labels: readonly TextRun[],
): DetectedField | undefined {
  const box = insidePage(candidate.box, layout.width, layout.height);
  if (!box || excludedCandidate(candidate, box, layout, candidates, fields)) return undefined;
  const label =
    (candidate.label &&
      ignoredLabel(candidate.label) &&
      candidate.method === "vector" &&
      directLabel(box, labels, candidate.checkbox, candidates)) ||
    candidate.label ||
    directLabel(box, labels, candidate.checkbox, candidates) ||
    columnLabel(candidate, candidates, labels) ||
    nearbyLabel(box, labels, candidate.checkbox, candidates);
  if (!label) return undefined;
  if (candidate.confidence === 0.6 && !nearWritingLabel(box, labels)) return undefined;
  const label_de = contextualLabel(label, box, labels, candidate.checkbox);
  if (!label_de) return undefined;
  const type = inferType(label_de, candidate.checkbox);
  const owner = ownerAt(box, layout);
  return {
    id: `p${layout.page}-detected-${index + 1}`,
    label_de,
    box,
    type,
    owner,
    signature: type === "signature" && owner === "applicant" ? "subject" : "none",
    confidence: candidate.confidence,
    method: candidate.method,
  };
}

function nearWritingLabel(box: FieldBox, runs: readonly TextRun[]): boolean {
  return runs.some(
    (run) =>
      /[\p{L}]/u.test(run.text) &&
      run.box.x + run.box.width >= box.x - 50 &&
      run.box.x <= box.x + box.width &&
      ((run.box.y + run.box.height <= box.y + 3 && box.y - run.box.y - run.box.height < 25) ||
        (run.box.x + run.box.width <= box.x + 2 &&
          Math.abs(run.box.y + run.box.height / 2 - box.y - box.height / 2) < 10) ||
        (["date", "signature"].includes(inferType(run.text)) &&
          Math.abs(run.box.y - box.y - box.height) < 16)),
  );
}

export type { DetectedField, DraftForm, FieldBox, FieldOwner, FieldType } from "./schema.ts";
export {
  DetectedFieldSchema,
  DraftFormSchema,
  FieldBoxSchema,
  FieldDetectionError,
} from "./schema.ts";
