import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BridgeToNativeSchema,
  BridgeToWorkspaceSchema,
  MESSAGE_SCHEMAS,
  TargetSchema,
} from "../src/index.ts";

const schemas = {
  ...MESSAGE_SCHEMAS,
  Target: TargetSchema,
  BridgeToNative: BridgeToNativeSchema,
  BridgeToWorkspace: BridgeToWorkspaceSchema,
};
// Test-only mutations of the existing protocol fixtures isolate each constraint.
// Swift reads this same corpus, including each explicit expected outcome.
const fixtures = z
  .array(
    z.strictObject({
      name: z.string(),
      schema: z.enum(Object.keys(schemas) as [keyof typeof schemas, ...(keyof typeof schemas)[]]),
      valid: z.boolean(),
      value: z.json(),
    }),
  )
  .parse(JSON.parse(readFileSync(new URL("fixtures/validation.json", import.meta.url), "utf8")));

describe("AC1 shared Swift and Zod constraint fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(schemas[fixture.schema].safeParse(fixture.value).success).toBe(fixture.valid);
    });
  }
});
