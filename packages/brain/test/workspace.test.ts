import type { ZodType } from "@lotse/protocol";
import { expectTypeOf, test } from "vitest";

test("AC4 resolves protocol types through the workspace export", () => {
  expectTypeOf<ZodType["parse"]>().parameter(0).toBeUnknown();
});
