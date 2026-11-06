import type { ViewerField } from "@lotse/brain/forms/viewer/schema";
import type { PDFPageProxy } from "pdfjs-dist";
import { z } from "zod";

export type PositionedField = {
  field: ViewerField;
  bounds: { x: number; y: number; width: number; height: number };
};
const WidgetSchema = z.object({
  subtype: z.literal("Widget"),
  fieldName: z.string(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export async function positionPageFields(
  page: PDFPageProxy,
  fields: readonly ViewerField[],
): Promise<PositionedField[]> {
  const viewport = page.getViewport({ scale: 1 });
  const annotations: unknown[] = await page.getAnnotations();
  const widgets = annotations.flatMap((value) => {
    const parsed = WidgetSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  return fields.flatMap((field) => {
    if (field.box) {
      if (field.box.page !== page.pageNumber) return [];
      return [{ field, bounds: normalizeBounds(field.box, viewport) }];
    }
    return widgets
      .filter((widget) => widget.fieldName === field.acro_field)
      .map((widget) => {
        const [left, top] = transformPoint(widget.rect[0], widget.rect[1], viewport.transform);
        const [right, bottom] = transformPoint(widget.rect[2], widget.rect[3], viewport.transform);
        const box = {
          x: Math.min(left, right),
          y: Math.min(top, bottom),
          width: Math.abs(right - left),
          height: Math.abs(bottom - top),
        };
        return { field, bounds: normalizeBounds(box, viewport) };
      });
  });
}

export function normalizeBounds(
  box: { x: number; y: number; width: number; height: number },
  page: { width: number; height: number },
): PositionedField["bounds"] {
  return {
    x: box.x / page.width,
    y: box.y / page.height,
    width: box.width / page.width,
    height: box.height / page.height,
  };
}

export function transformPoint(x: number, y: number, matrix: readonly number[]): [number, number] {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}
