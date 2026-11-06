import { formFields } from "@lotse/db/schema";
import {
  degrees,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  type PDFField,
  type PDFForm,
  PDFOptionList,
  type PDFPage,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import {
  FORM_GEOMETRY_EPSILON,
  FORM_PDF_FONT_HEIGHT_RATIO,
  FORM_PDF_FONT_SIZE,
} from "../../config/index.ts";
import { identityField, validFieldValue, writableField } from "../policy.ts";
import { FormError, type FormField, type FormSchema, INSURANCE_NUMBER } from "../schema.ts";

function clearField(field: PDFField): void {
  if (field instanceof PDFTextField) field.setText(undefined);
  else if (field instanceof PDFCheckBox) field.uncheck();
  else if (
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList ||
    field instanceof PDFRadioGroup
  )
    field.clear();
}

function assign(field: PDFField, value: string | number | boolean): void {
  if (field instanceof PDFTextField) field.setText(String(value));
  else if (field instanceof PDFCheckBox && typeof value === "boolean") {
    if (value) field.check();
    else field.uncheck();
  } else if (
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList ||
    field instanceof PDFRadioGroup
  ) {
    if (!field.getOptions().includes(String(value))) throw new FormError("invalid_fields");
    field.select(String(value));
  } else throw new FormError("invalid_fields");
}

function addedField(form: PDFForm, pages: PDFPage[], field: FormField): PDFField {
  const box = field.box;
  const page = box && pages[box.page - 1];
  if (!box || !page || box.width <= 0 || box.height <= 0) throw new FormError("invalid_fields");
  const crop = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const displayWidth = rotation % 180 === 0 ? crop.width : crop.height;
  const displayHeight = rotation % 180 === 0 ? crop.height : crop.width;
  if (
    box.x + box.width > displayWidth + FORM_GEOMETRY_EPSILON ||
    box.y + box.height > displayHeight + FORM_GEOMETRY_EPSILON
  )
    throw new FormError("invalid_fields");
  // Convert the displayed top-left CropBox into native PDF coordinates.
  const point =
    rotation === 0
      ? { x: crop.x + box.x, y: crop.y + crop.height - box.y - box.height }
      : rotation === 90
        ? { x: crop.x + box.y + box.height, y: crop.y + box.x }
        : rotation === 180
          ? { x: crop.x + crop.width - box.x, y: crop.y + box.y + box.height }
          : { x: crop.x + crop.width - box.y - box.height, y: crop.y + crop.height - box.x };
  const options = {
    ...point,
    width: box.width,
    height: box.height,
    rotate: degrees(rotation),
    borderWidth: 0,
  };
  const added =
    field.type === "checkbox"
      ? form.createCheckBox(`lotse.${field.id}`)
      : form.createTextField(`lotse.${field.id}`);
  added.addToPage(page, options);
  if (added instanceof PDFTextField)
    added.setFontSize(Math.min(FORM_PDF_FONT_SIZE, box.height * FORM_PDF_FONT_HEIGHT_RATIO));
  return added;
}

/** A fresh original is used every time; drafts and provider fields never reach the PDF. */
export async function renderFormPdf(
  original: Uint8Array,
  schema: FormSchema,
  rawFields: unknown,
): Promise<Uint8Array> {
  const fields = formFields.parse(rawFields);
  const document = await PDFDocument.load(original);
  const form = document.getForm();
  if (form.hasXFA()) throw new FormError("unsupported_format");
  for (const field of form.getFields()) clearField(field);
  const written = new Map<string, string>();
  // Shared identity fields (the insurance number) stay writable; see templateSchema.
  const shared = new Set(
    schema.fields
      .filter(
        (field) =>
          identityField(field) || (writableField(field) && INSURANCE_NUMBER.test(field.label_de)),
      )
      .map((field) => field.acro_field),
  );
  const restricted = new Set(
    schema.fields
      .filter((field) => !writableField(field) && !shared.has(field.acro_field))
      .map((field) => field.acro_field),
  );
  for (const field of schema.fields) {
    const entry = fields[field.id];
    // Drafts filled from the person's own statements or confirmed facts carry provenance and are
    // part of the prepared PDF; drafts without provenance are not.
    const sourced = entry?.state === "draft" && Boolean(entry.provenance);
    if (
      (entry?.state !== "confirmed" && !sourced) ||
      !entry ||
      !(writableField(field) || identityField(field) || sourced) ||
      (!sourced && field.acro_field && restricted.has(field.acro_field))
    )
      continue;
    if (sourced && (!validFieldValue(field, entry.value) || typeof entry.value === "object"))
      continue;
    if (
      !validFieldValue(field, entry.value) ||
      entry.value === null ||
      typeof entry.value === "object"
    )
      throw new FormError("invalid_fields");
    const identity = field.acro_field ?? field.id;
    const previous = written.get(identity);
    if (previous !== undefined && previous !== JSON.stringify(entry.value))
      throw new FormError("invalid_fields");
    written.set(identity, JSON.stringify(entry.value));
    const pdfField =
      (field.acro_field && form.getFieldMaybe(field.acro_field)) ||
      addedField(form, document.getPages(), field);
    assign(pdfField, entry.value);
  }
  form.updateFieldAppearances(await document.embedFont(StandardFonts.Helvetica));
  return document.save();
}
