import { describe, expect, it } from "vitest";
import { toolLabel } from "../src/conversation/tool-labels.ts";

describe("toolLabel", () => {
  it("maps dotted tool names to German labels", () => {
    expect(toolLabel("office.resolve", "de")).toBe("Zuständige Stelle finden");
    expect(toolLabel("documents.checklist", "de")).toBe("Dokumente prüfen");
  });

  it("maps raw prefixed tool names", () => {
    expect(toolLabel("lotse_catalog_findBenefits", "de")).toBe("Leistungen suchen");
    expect(toolLabel("lotse_office_resolve", "en")).toBe("Find responsible office");
  });

  it("labels knowledge search tools", () => {
    expect(toolLabel("knowledge_search", "de")).toBe("Wissen durchsuchen");
  });

  it("humanises unknown names", () => {
    expect(toolLabel("lotse_letter_draftReply", "de")).toBe("Letter draft reply");
  });
});
