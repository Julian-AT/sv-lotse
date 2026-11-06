export const FORM_VIEWER_CONFIG = {
  actionMountTimeoutMs: 10_000,
  pdfAssets: "/api/pdfjs/",
  maxPixelRatio: 2,
  maxCanvasPixels: 16_000_000,
  minZoom: 0.5,
  maxZoom: 2,
  zoomStep: 0.25,
  cursorSize: 24,
  largeCursorSize: 40,
  slowPaceMultiplier: 2,
  reducedMotionQuery: "(prefers-reduced-motion: reduce)",
} as const;
export const formInstanceUrl = (id: string): string =>
  `/api/forms/instances/${encodeURIComponent(id)}`;
export const formPdfUrl = (id: string): string =>
  `/api/forms/${encodeURIComponent(id)}/pdf?source=original`;
export const formTemplateUrl = (id: string): string =>
  `/api/forms/templates/${encodeURIComponent(id)}`;
export const FORM_REVIEW_CONFIG = {
  minSize: 2,
  keyboardStep: 1,
  newField: { x: 20, y: 20, width: 120, height: 24 },
} as const;
export const formPackageUrl = (id: string): string => `${formInstanceUrl(id)}/package`;
export const formExportUrl = (id: string): string => `${formInstanceUrl(id)}/pdf`;

export const FORM_FILL_STOP_EVENT = "lotse:form-fill-stop";

/** Window event with `detail: boolean`: whether the form viewer is typing values right now. */
export const FORM_FILLING_EVENT = "lotse:form-filling";

export function stopFormFilling(): void {
  window.dispatchEvent(new Event(FORM_FILL_STOP_EVENT));
}

export const formViewerUrl = (id: string): string => `/forms/${encodeURIComponent(id)}`;
