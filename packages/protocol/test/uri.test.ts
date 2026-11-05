import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, it } from "vitest";
import { z } from "zod";
import { ContextCapsuleSchema, SpeechSegmentSchema, TargetSchema } from "../src/index.ts";

const uriFields = [
  TargetSchema.options[2].shape.url,
  ContextCapsuleSchema.shape.page.unwrap().shape.url,
  SpeechSegmentSchema.shape.citations.element.shape.url,
];
const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validateURI = ajv.compile({ type: "string", format: "uri" });

for (const [uri, valid] of [
  ["https://example.com/entlassungsbrief%20%C3%B6sterreich", true],
  ["https://example.com/%c3%b6sterreich?q=Pr%C3%BCfung#page-5", true],
  ["https://user:password@example.com:443/document?x=1&y=2#page-5", true],
  ["http://[2001:db8::1]/document", true],
  ["http://[::ffff:192.0.2.1]/document", true],
  ["http://[v1.example]/document", true],
  ["urn:isbn:0451450523", true],
  ["mailto:beratung@example.com", true],
  ["file:///documents/discharge.pdf", true],
  ["custom:", false],
  ["/documents/discharge.pdf", false],
  ["https://example.com/raw space", false],
  ["https://example.com/österreich", false],
  ["https://example.com/%zz", false],
  ["https://example.com/%2", false],
  ["https://example.com/%", false],
  ["https://österreich.example/", false],
  ["https://example.com/?q=raw space", false],
  ["https://example.com/#österreich", false],
  ["https://example.com/\\document", false],
  ["https://example.com/<document>", false],
  ["https://example.com/[document]", false],
  ["https://example.com/#page#5", false],
  // The generic URI format does not enforce HTTP-specific authority semantics.
  ["https://example.com:invalid/", true],
  ["https://[2001:::1]/", false],
  ["https://[::ffff:999.0.2.1]/", false],
  [" https://example.com/", false],
  ["https://example.com/\n", false],
  ["https://example.com/\u0000", false],
] as const) {
  it(`AC2 all URI fields agree with format uri on ${JSON.stringify(uri)}`, () => {
    expect(validateURI(uri)).toBe(valid);
    for (const field of uriFields) {
      expect(field.safeParse(uri).success).toBe(valid);
      if (valid) expect(field.parse(uri)).toBe(uri);
    }
  });
}

it("AC2 every URI field emits the JSON Schema uri format", () => {
  for (const field of uriFields) {
    expect(z.toJSONSchema(field)).toMatchObject({ type: "string", format: "uri" });
  }
});

it("AC2 URI character validation agrees across authority, path, query and fragment", () => {
  for (const [prefix, suffix] of [
    ["https://", ".example/document"],
    ["https://", "@example.com/document"],
    ["https://example.com/", ""],
    ["https://example.com/?q=", ""],
    ["https://example.com/#", ""],
  ]) {
    for (let code = 0; code < 128; code += 1) {
      const uri = `${prefix}${String.fromCharCode(code)}${suffix}`;
      for (const field of uriFields) {
        expect(field.safeParse(uri).success, JSON.stringify(uri)).toBe(validateURI(uri));
      }
    }
  }
});
