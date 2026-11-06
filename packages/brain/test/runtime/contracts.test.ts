import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allowedToolNames } from "../../src/agent/permissions.ts";
import { inputHash } from "../../src/approvals/canonical.ts";
import { parseBrainConfig } from "../../src/config/index.ts";
import { contracts } from "../../src/tools/contracts/index.ts";
import { CatalogError } from "../../src/tools/impl/catalog/errors.ts";
import { buildTools } from "../../src/tools/registry.ts";

describe("runtime contracts", () => {
  it("AC1 registers every PRD section 8 tool and the deadline/letter extensions", () => {
    const prd = readFileSync(
      new URL("../../../../docs/prd/SV-KI-Lotse-PRD.md", import.meta.url),
      "utf8",
    );
    const table = prd.split("### Tools\n")[1]?.split("The autonomy level")[0] ?? "";
    const names = [...table.matchAll(/`([a-z]+\.[a-zA-Z]+)`/g)].map((match) => match[1]);
    expect(Object.keys(contracts).sort()).toEqual(
      [
        ...new Set([
          ...names,
          "docs.explainLetter",
          "reminder.list",
          "reminder.extract",
          "appointment.rehearse",
          "web.findOfficialPage",
        ]),
      ].sort(),
    );
    expect(Object.keys(buildTools({ allowStubs: false })).sort()).toEqual(
      Object.keys(contracts).sort(),
    );
  });

  it("AC2 the real catalog fails closed without a database and never returns a fixture", async () => {
    const tools = buildTools({ allowStubs: false });
    const execute = tools["catalog.getBenefit"]?.execute;
    expect(execute).toBeTypeOf("function");
    if (!execute) throw new Error("Missing tool execution");
    await expect(
      execute(
        { benefitId: "opaque-reference" },
        {
          toolCallId: "call",
          messages: [],
          context: {
            caseId: "case",
            subjectId: "subject",
            actorId: "actor",
            userId: "user",
            sessionId: "session",
            actorRole: "subject",
            autonomyLevel: "L1",
            shareScope: {},
            sentenceIndex: 0,
          },
        },
      ),
    ).rejects.toBeInstanceOf(CatalogError);
  });

  it("NFR-17 document extraction uses a real database dependency with fixtures disabled", async () => {
    const execute = buildTools({ allowStubs: false })["docs.extractStatements"].execute;
    if (!execute) throw new Error("Missing tool execution");
    await expect(
      execute(
        { documentId: "opaque-reference" },
        {
          toolCallId: "call",
          messages: [],
          context: {
            caseId: "case",
            subjectId: "subject",
            actorId: "actor",
            userId: "user",
            sessionId: "session",
            actorRole: "subject",
            autonomyLevel: "L1",
            shareScope: {},
            sentenceIndex: 0,
          },
        },
      ),
    ).rejects.toThrow("Database is required for this tool");
  });

  it("FR-A1 removes approval tools and live typing at L1 and prevents helper approvals", () => {
    for (const name of allowedToolNames("L1", "subject")) {
      expect(contracts[name].approval).toBe(false);
      expect(name).not.toBe("form.fillLive");
    }
    expect(allowedToolNames("L2", "subject")).toContain("ui.fill");
    expect(allowedToolNames("L3", "subject")).toContain("form.commitGroup");
    expect(allowedToolNames("L3", "helper")).not.toContain("ui.fill");
  });

  it("FR-A2 hashes RFC 8785 canonical JSON and rejects invalid Unicode", () => {
    expect(inputHash({ b: 2, a: { x: 1, y: -0 } })).toBe(inputHash({ a: { y: 0, x: 1 }, b: 2 }));
    expect(() => inputHash({ x: Number.NaN })).toThrow();
    expect(() => inputHash({ x: "\ud800" })).toThrow();
  });

  it("validates secrets and explicit stub flags without exposing their values", () => {
    expect(() => parseBrainConfig({ APPROVAL_HMAC_SECRET: "short" })).toThrow(
      "APPROVAL_HMAC_SECRET",
    );
    expect(() =>
      parseBrainConfig({ APPROVAL_HMAC_SECRET: "s".repeat(32), BRAIN_ALLOW_STUBS: "true" }),
    ).toThrow("BRAIN_ALLOW_STUBS");
    expect(parseBrainConfig({ APPROVAL_HMAC_SECRET: "s".repeat(32) }).allowStubs).toBe(false);
    expect(() =>
      parseBrainConfig({ APPROVAL_HMAC_SECRET: "s".repeat(32), BRAIN_ALLOW_STUBS: "1" }),
    ).toThrow("BRAIN_ALLOW_STUBS");
    const blank = parseBrainConfig({
      APPROVAL_HMAC_SECRET: "s".repeat(32),
      BRAIN_ALLOW_STUBS: "",
      OPENAI_MODEL_ORCHESTRATOR: "",
    });
    expect(blank.allowStubs).toBe(false);
    expect(blank.models.orchestrator.primary.length).toBeGreaterThan(0);
  });
});
