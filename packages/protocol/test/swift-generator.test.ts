import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { generateSwiftValidationFixture } from "../scripts/swift-validation-fixture.ts";

it("NFR-13 generated Swift enforces constraints absent from the frozen schema", async () => {
  const generated = generateSwiftValidationFixture();
  const fixture = await readFile(
    new URL(
      "../swift/Tests/SwiftValidationGeneratorTests/Generated/ValidationFixture.swift",
      import.meta.url,
    ),
    "utf8",
  );
  expect(fixture).toBe(generated);
  expect(generated).toContain("self.text.utf16.count >= 2");
  expect(generated).toContain("self.text.utf16.count <= 3");
  expect(generated).toContain("self.number.isFinite");
  expect(generated).toContain("self.number.rounded(.towardZero) == self.number");
  expect(generated).toContain("self.number > 0");
  expect(generated).toContain("self.number < 10");
  expect(generated).toContain('self.token == "fixed"');
  expect(generated).toContain("item.utf16.count <= 2");
  expect(generated).toContain('path + ["labels"] + [String(index)]');
});
