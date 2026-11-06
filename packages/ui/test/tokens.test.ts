import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { colorTokens, contrastPairs, tokens } from "../src/tokens/index";

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
  for (const [theme, colors] of Object.entries(colorTokens)) {
    for (const [foreground, background, minimum] of contrastPairs) {
      it(`${theme}: ${foreground} on ${background} reaches ${minimum}:1`, () => {
        expect(contrast(colors[foreground], colors[background])).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
  it("publishes the exact typed tokens in the stylesheet, including dark and reduced motion", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    for (const [name, value] of Object.entries(tokens)) {
      expect(css).toContain(`--lotse-${name}: ${value};`);
    }
    for (const colors of Object.values(colorTokens)) {
      for (const [name, value] of Object.entries(colors)) {
        expect(css).toContain(`--lotse-${name}: ${value};`);
      }
    }
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain('data-lotse-theme="dark"');
  });
});
