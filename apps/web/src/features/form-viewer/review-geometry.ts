import type { ReviewedField } from "@lotse/brain/forms/registry/schema";
import { FORM_REVIEW_CONFIG } from "./config.ts";
export type ReviewPageSize = { width: number; height: number };
export type ReviewBox = ReviewedField["box"];

export function constrainReviewBox(box: ReviewBox, size: ReviewPageSize): ReviewBox {
  const width = Math.min(size.width, Math.max(FORM_REVIEW_CONFIG.minSize, box.width));
  const height = Math.min(size.height, Math.max(FORM_REVIEW_CONFIG.minSize, box.height));
  return {
    ...box,
    width,
    height,
    x: Math.max(0, Math.min(size.width - width, box.x)),
    y: Math.max(0, Math.min(size.height - height, box.y)),
  };
}
export function keyReviewBox(
  box: ReviewBox,
  key: string,
  resize: boolean,
  size: ReviewPageSize,
): ReviewBox {
  const step = FORM_REVIEW_CONFIG.keyboardStep;
  const x = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const y = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  return constrainReviewBox(
    resize
      ? { ...box, width: box.width + x, height: box.height + y }
      : { ...box, x: box.x + x, y: box.y + y },
    size,
  );
}
