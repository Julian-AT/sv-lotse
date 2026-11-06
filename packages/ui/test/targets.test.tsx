import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  Button,
  Checkbox,
  Disclosure,
  IconButton,
  Link,
  Radio,
  Select,
  Tabs,
  TextInput,
  tokens,
} from "../src/index";

function pixels(value: string): number {
  const resolved = value === "var(--lotse-target-size)" ? tokens["target-size"] : value;
  return Number.parseFloat(resolved);
}

it("every interactive primitive enforces at least a 44 CSS-pixel target in both dimensions", () => {
  render(
    <main>
      <Button>Weiter</Button>
      <IconButton label="Öffnen" />
      <Link href="https://www.sozialversicherung.at/">Quelle</Link>
      <TextInput aria-label="Name" />
      <Select aria-label="Sprache">
        <option>Deutsch</option>
      </Select>
      <Checkbox label="Bestätigt" />
      <Radio label="Deutsch" name="language" />
      <Disclosure summary="Mehr">Details</Disclosure>
      <Tabs label="Ansicht" items={[{ id: "first", label: "Erste", content: "Inhalt" }]} />
    </main>,
  );
  const targets = [
    ...screen.getAllByRole("button"),
    screen.getByRole("link"),
    screen.getByRole("textbox"),
    screen.getByRole("combobox"),
    screen.getByRole("tab"),
    screen.getByText("Mehr"),
  ];
  for (const target of targets) {
    const style = getComputedStyle(target);
    expect(pixels(style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(pixels(style.minHeight)).toBeGreaterThanOrEqual(44);
  }
  for (const target of [screen.getByRole("checkbox"), screen.getByRole("radio")]) {
    const style = getComputedStyle(target);
    expect(pixels(style.width)).toBeGreaterThanOrEqual(44);
    expect(pixels(style.height)).toBeGreaterThanOrEqual(44);
  }
});
