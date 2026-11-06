/** All dimensions use CSS pixels or rem; 44px is the minimum CSS touch target. */
export const tokens = {
  // Modal opaque green sampled from assets/brand/sv-logo-source.png.
  "color-brand": "#008e5c",
  "color-brand-hover": "#007b50",
  "color-brand-pressed": "#006d47",
  "color-brand-helper": "#78dbad",
  // AA text on both the exact brand green and the lighter helper tint.
  "color-on-brand": "#001008",
  "font-body": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  "font-heading": '"Charter", "Georgia", serif',
  "text-small": "0.9375rem",
  "text-body": "1.125rem",
  "text-large": "1.375rem",
  "text-title": "1.75rem",
  "text-display": "2.25rem",
  "line-height": "1.6",
  "space-small": "0.5rem",
  "space-medium": "1rem",
  "space-large": "1.5rem",
  "space-xlarge": "2rem",
  "radius-small": "0.75rem",
  "radius-medium": "1.25rem",
  "radius-large": "1.75rem",
  "radius-pill": "999px",
  "elevation-card": "0 2px 8px rgb(0 0 0 / 0.08)",
  "elevation-dialog": "0 16px 48px rgb(0 0 0 / 0.24)",
  "glass-opacity": "0.86",
  "glass-blur": "24px",
  "glass-filter": "none",
  "glass-background": "var(--lotse-surface)",
  "glass-edge": "var(--lotse-border)",
  "glass-shadow": "var(--lotse-elevation-card)",
  "canvas-decoration":
    "radial-gradient(60rem 42rem at 0% 0%, rgb(0 142 92 / 0.18), transparent 70%), radial-gradient(56rem 44rem at 100% 28%, rgb(120 219 173 / 0.24), transparent 70%), radial-gradient(48rem 36rem at 40% 100%, rgb(0 142 92 / 0.12), transparent 70%)",
  "focus-width": "3px",
  "focus-offset": "3px",
  "target-size": "44px",
  "motion-fast": "120ms",
  "motion-slow": "800ms",
  "motion-easing": "ease-out",
} as const;

export const colorTokens = {
  light: {
    "color-brand-text": "#006d47",
    canvas: "#f2f7f5",
    surface: "#ffffff",
    text: "#162f2a",
    muted: "#405d54",
    border: "#637e73",
    accent: "#006d47",
    "on-accent": "#ffffff",
    subtle: "#e6f1eb",
    danger: "#a11b29",
    "on-danger": "#ffffff",
    "danger-surface": "#fff0f1",
    success: "#186043",
    "success-surface": "#ecf7f0",
    warning: "#725000",
    "warning-surface": "#fff5d6",
    focus: "#1056ac",
  },
  dark: {
    "color-brand-text": "#78dbad",
    canvas: "#101e1b",
    surface: "#1b3029",
    text: "#f0f8f4",
    muted: "#c1d6cb",
    border: "#96b6a6",
    accent: "#98e2bd",
    "on-accent": "#101e1b",
    subtle: "#28483b",
    danger: "#ffb5bd",
    "on-danger": "#101c2a",
    "danger-surface": "#412830",
    success: "#94e0b5",
    "success-surface": "#1b3b32",
    warning: "#f4d47d",
    "warning-surface": "#3e3520",
    focus: "#b5daff",
  },
} as const;

/** High opacity bounds text contrast even over an entirely black or white backdrop. */
export const materialTokens = {
  light: {
    "glass-tint": "rgb(255 255 255 / var(--lotse-glass-opacity))",
    "glass-highlight": "rgb(255 255 255 / 0.9)",
    "glass-elevation":
      "inset 0 1px 0 var(--lotse-glass-highlight), 0 2px 6px rgb(19 52 39 / 0.04), 0 16px 40px -12px rgb(19 52 39 / 0.14)",
  },
  dark: {
    "glass-tint": "rgb(27 48 41 / var(--lotse-glass-opacity))",
    "glass-highlight": "rgb(255 255 255 / 0.12)",
    "glass-elevation":
      "inset 0 1px 0 var(--lotse-glass-highlight), 0 2px 6px rgb(0 0 0 / 0.16), 0 16px 40px -12px rgb(0 0 0 / 0.4)",
  },
} as const;

export type MaterialVariant = "solid" | "glass";
export type ColorToken = keyof typeof colorTokens.light;
export type Theme = keyof typeof colorTokens;
export type Space = "small" | "medium" | "large" | "xlarge";
/** Text pairs require 4.5:1; boundaries and focus indicators require 3:1. */
export const contrastPairs = [
  ["color-brand-text", "surface", 4.5],
  ["color-brand-text", "canvas", 4.5],
  ["color-brand-text", "subtle", 4.5],
  ["text", "surface", 4.5],
  ["text", "canvas", 4.5],
  ["text", "subtle", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "canvas", 4.5],
  ["muted", "subtle", 4.5],
  ["accent", "surface", 4.5],
  ["accent", "canvas", 4.5],
  ["accent", "subtle", 4.5],
  ["on-accent", "accent", 4.5],
  ["on-danger", "danger", 4.5],
  ["danger", "danger-surface", 4.5],
  ["danger", "surface", 4.5],
  ["success", "success-surface", 4.5],
  ["warning", "warning-surface", 4.5],
  ["border", "surface", 3],
  ["border", "canvas", 3],
  ["border", "subtle", 3],
  ["focus", "surface", 3],
  ["focus", "canvas", 3],
  ["focus", "subtle", 3],
] as const satisfies ReadonlyArray<readonly [ColorToken, ColorToken, number]>;
