import { ContextCapsuleSchema } from "@lotse/protocol";
import { expect, test } from "vitest";
import { toCapsulePage } from "../../src/index.ts";

test("AC1 projects only visible non-credential handles to the frozen capsule page shape", () => {
  const field = {
    handle: "field-handle",
    role: "textbox",
    label: "Name",
    value: "Alex",
    visible: true,
    credential: false,
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
  };
  const page = toCapsulePage({
    url: "https://example.test/form",
    handles: [
      field,
      { ...field, handle: "hidden-handle", visible: false },
      { ...field, handle: "credential-handle", credential: true },
    ],
  });
  expect(ContextCapsuleSchema.shape.page.parse(page)).toEqual({
    url: "https://example.test/form",
    handles: [
      {
        id: field.handle,
        role: field.role,
        label: field.label,
        value: field.value,
        bbox: field.bbox,
      },
    ],
  });
});
