import { PDFDocument } from "pdf-lib";

/** Copy only approved pages into the stored original; hidden pages never reach storage or OCR. */
export async function approvedDocumentBytes(
  bytes: Uint8Array,
  pageCount: number,
  allowed: readonly number[],
): Promise<Uint8Array> {
  const original = await PDFDocument.load(bytes);
  if (
    original.getPageCount() !== pageCount ||
    allowed.length === 0 ||
    new Set(allowed).size !== allowed.length ||
    allowed.some((page) => !Number.isInteger(page) || page < 1 || page > pageCount)
  )
    throw new Error("invalid_document_pages");
  const subset = await PDFDocument.create();
  for (const page of await subset.copyPages(
    original,
    allowed.map((page) => page - 1),
  ))
    subset.addPage(page);
  return subset.save();
}
