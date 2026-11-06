/** DOM selectors are shared by Dialog's focus containment and keyboard loop. */
export const FOCUSABLE_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[tabindex]",
  "[contenteditable='true']",
].join(",");
export const URL_SCHEMES = new Set(["https:", "http:", "mailto:", "tel:"]);
