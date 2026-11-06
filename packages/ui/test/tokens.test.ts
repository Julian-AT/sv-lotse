import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { colorTokens, contrastPairs, materialTokens, tokens } from "../src/tokens/index";

function composite(surface: string, backdrop: number): string {
  const opacity = Number(tokens["glass-opacity"]);
  return `#${[1, 3, 5]
    .map((offset) => {
      const channel = Number.parseInt(surface.slice(offset, offset + 2), 16);
      return Math.round(channel * opacity + backdrop * (1 - opacity))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function luminance(hex: string): number {
  const channels =
    hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((channel) => {
        const value = Number.parseInt(channel, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }) ?? [];
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("AC3: AA contrast", () => {
  it("keeps the measured brand green and uses a readable text variant", () => {
    expect(tokens["color-brand"]).toBe("#008e5c");
    expect(contrast(tokens["color-brand"], colorTokens.light.surface)).toBeLessThan(4.5);
    expect(
      contrast(colorTokens.light["color-brand-text"], colorTokens.light.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps companion and helper labels at AA contrast on green", () => {
    for (const background of [tokens["color-brand"], tokens["color-brand-helper"]]) {
      expect(contrast(tokens["color-on-brand"], background)).toBeGreaterThanOrEqual(4.5);
    }
  });
  for (const [theme, colors] of Object.entries(colorTokens)) {
    for (const backdrop of [0, 255]) {
      for (const foreground of ["text", "muted", "accent", "color-brand-text"] as const) {
        it(`${theme}: glass keeps ${foreground} AA over backdrop ${backdrop}`, () => {
          expect(
            contrast(colors[foreground], composite(colors.surface, backdrop)),
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    for (const [foreground, background, minimum] of contrastPairs) {
      it(`${theme}: ${foreground} on ${background} reaches ${minimum}:1`, () => {
        expect(contrast(colors[foreground], colors[background])).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
  it("publishes the exact typed tokens in the stylesheet, including dark and reduced motion", () => {
    // CSS formatting may wrap a value; compare all of its tokens independent of whitespace.
    const css = readFileSync(resolve("src/styles.css"), "utf8").replace(/\s+/g, " ");
    for (const [name, value] of Object.entries(tokens)) {
      expect(css).toContain(`--lotse-${name}: ${value};`);
    }
    for (const colors of Object.values(colorTokens)) {
      for (const [name, value] of Object.entries(colors)) {
        expect(css).toContain(`--lotse-${name}: ${value};`);
      }
    }
    for (const material of Object.values(materialTokens)) {
      for (const [name, value] of Object.entries(material)) {
        expect(css).toContain(`--lotse-${name}: ${value};`);
      }
    }
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("prefers-contrast: more");
    expect(css).toContain("--lotse-glass-background: var(--lotse-surface)");
    expect(css).toContain("--lotse-glass-filter: none");
    expect(css).toContain('data-lotse-theme="dark"');
  });
});
