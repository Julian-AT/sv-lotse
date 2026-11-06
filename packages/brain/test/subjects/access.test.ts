import { describe, expect, test } from "vitest";
import { allowedToolNames } from "../../src/agent/permissions.ts";
import { canReadFactType, effectiveShareScope } from "../../src/subjects/access.ts";
import { isApprovalAttempt } from "../../src/subjects/rate-limit.ts";
import { contracts } from "../../src/tools/contracts/index.ts";

describe("FR-P7 / FR-R4 / FR-R5 helper boundaries", () => {
  test("both persisted scope formats grant the same exact fact types", () => {
    for (const scope of [
      { mode: "restricted", factTypes: ["residence"] },
      { case: true, facts: ["residence"] },
    ]) {
      expect(canReadFactType(scope, "residence")).toBe(true);
      expect(canReadFactType(scope, "residence.other")).toBe(false);
      expect(effectiveShareScope(scope).documents).not.toBe(true);
    }
    expect(effectiveShareScope({ mode: "full" })).toEqual({
      case: true,
      facts: true,
      documents: true,
    });
  });
  test("malformed and screen-only scopes deny case context", () => {
    for (const scope of [
      {},
      null,
      { mode: "full", extra: true },
      { case: false, facts: true },
      { mode: "restricted", case: false, factTypes: ["residence"] },
    ]) {
      expect(canReadFactType(scope, "residence")).toBe(false);
      expect(effectiveShareScope(scope).case).toBe(false);
    }
  });
  test("L3 never lets a helper approve signature fields or perform approval-gated actions", () => {
    for (const level of ["L1", "L2", "L3"] as const) {
      const names = allowedToolNames(level, "helper");
      expect(names).not.toContain("form.commitGroup");
      expect(names).not.toContain("form.fillLive");
      expect(names).not.toContain("process.completeStep");
      expect(names).not.toContain("package.build");
      expect(names).not.toContain("ui.fill");
      expect(names.every((name) => !contracts[name].approval)).toBe(true);
    }
  });
  test("approval continuations are detected without reading or logging their content", () => {
    expect(
      isApprovalAttempt({
        parts: [{ type: "tool-form.commitGroup", state: "approval-responded" }],
      }),
    ).toBe(true);
    expect(isApprovalAttempt({ parts: [{ type: "tool-approval-response" }] })).toBe(true);
    expect(isApprovalAttempt({ parts: [{ type: "text", text: "Please prepare a draft" }] })).toBe(
      false,
    );
    expect(isApprovalAttempt(null)).toBe(false);
  });
});
