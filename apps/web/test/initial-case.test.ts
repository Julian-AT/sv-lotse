import { expect, test } from "vitest";
import { selectInitialCase } from "../src/conversation/initial-case.ts";
import type { CaseSummary } from "../src/conversation/schemas.ts";

const cases: CaseSummary[] = [
  {
    id: "0741a9c8-d2ee-4e25-8b81-67d42b50bb75",
    subjectId: "00ea3a3c-77cd-4df5-8266-aa2d181ef1b9",
    confirmedGoal: "",
    status: "active",
    autonomyLevel: "L1",
  },
  {
    id: "9b804a9d-7569-48e2-aea0-9b337f5b0f58",
    subjectId: "00ea3a3c-77cd-4df5-8266-aa2d181ef1b9",
    confirmedGoal: "",
    status: "active",
    autonomyLevel: "L1",
  },
];

test("native dashboard selection loads that conversation rather than the newest one", () => {
  expect(selectInitialCase(cases, `?caseId=${cases[1]?.id}`)).toBe(cases[1]);
});

test("missing or inaccessible explicit conversation selections fail closed", () => {
  expect(() => selectInitialCase(cases, "?caseId=missing")).toThrow("CASE_ACCESS_DENIED");
});

test("the ordinary workspace still selects the latest available conversation", () => {
  expect(selectInitialCase(cases, "")).toBe(cases[0]);
  expect(selectInitialCase([], "")).toBeUndefined();
});
