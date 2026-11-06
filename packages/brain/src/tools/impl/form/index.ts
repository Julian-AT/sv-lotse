import { stubGroup } from "../../stubs.ts";
import type { ToolDependencies } from "../../types.ts";
export function implementations(deps: ToolDependencies) {
  return stubGroup(deps, {
    "form.find": [],
    "form.acquire": {
      id: "stub-reference",
      format: "flat",
      pages: 1,
      hash: "0000000000000000000000000000000000000000000000000000000000000000",
      retrievedAt: "2026-01-01T00:00:00Z",
      status: "auto",
    },
    "form.analyze": { templateId: "stub-reference", fields: [], status: "auto" },
    "form.getSchema": { templateId: "stub-reference", fields: [], status: "auto" },
    "form.prefill": { formInstanceId: "stub-reference", proposals: [], missingFields: [] },
    "form.commitGroup": { values: {}, approvalId: "stub-reference" },
    "package.build": { pdfKey: "stub-reference", attachmentChecklist: [], coverLetter: "" },
  });
}
