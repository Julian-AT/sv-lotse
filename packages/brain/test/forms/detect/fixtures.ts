import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";

export const formsDirectory = join(
  resolve(import.meta.dirname, "../../../../..", process.env.SVBOX_DIR ?? "data/svbox"),
  "Anträge und Formulare",
);

export async function formNames() {
  return (await readdir(formsDirectory)).filter((name) => name.endsWith(".pdf")).sort();
}

export async function readForm(name: string) {
  return new Uint8Array(await readFile(join(formsDirectory, name)));
}

/** Independent gold from the original AcroForm, before flattening with pdf-lib. */
export async function widgetGold(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  const pages = document.getPages();
  return document
    .getForm()
    .getFields()
    .flatMap((field) =>
      field.acroField.getWidgets().map((widget) => {
        const pageIndex = pages.findIndex((page) =>
          page.node
            .Annots()
            ?.asArray()
            .some((ref) => document.context.lookup(ref) === widget.dict),
        );
        const page = pages[pageIndex];
        if (!page) throw new Error("Widget has no page");
        const rect = widget.getRectangle();
        return {
          name: field.getName(),
          type:
            field instanceof PDFCheckBox
              ? "checkbox"
              : field instanceof PDFTextField
                ? "text"
                : "other",
          box: {
            page: pageIndex + 1,
            x: Math.min(rect.x, rect.x + rect.width),
            y: page.getHeight() - Math.max(rect.y, rect.y + rect.height),
            width: Math.abs(rect.width),
            height: Math.abs(rect.height),
          },
        };
      }),
    );
}

export async function flatten(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  document.getForm().flatten();
  return document.save();
}
