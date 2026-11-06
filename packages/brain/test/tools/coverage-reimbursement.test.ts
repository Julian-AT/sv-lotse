import { afterEach, expect, test, vi } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { contracts } from "../../src/tools/contracts/index.ts";
import { buildTools } from "../../src/tools/registry.ts";

// Both tools run through the real registry, with the real, read-only SV-Box files.
// No database, provider, mock or opt-in fixture path is used.
const tools = buildTools({ allowStubs: false });
const context: RuntimeContext = {
  caseId: "case",
  subjectId: "subject",
  actorId: "actor",
  userId: "user",
  sessionId: "session",
  actorRole: "subject",
  autonomyLevel: "L1",
  shareScope: {},
  sentenceIndex: 0,
};
const options = { toolCallId: "administrative-lookup", messages: [], context };

async function coverage(medicineNameExact: string) {
  const execute = tools["eko.lookupCoverage"].execute;
  if (!execute) throw new Error("Missing coverage implementation");
  return contracts["eko.lookupCoverage"].output.parse(
    await execute({ medicineNameExact }, options),
  );
}

async function reimbursement(input: { tariffPositionId?: string; serviceDescription?: string }) {
  const execute = tools["fees.explainReimbursement"].execute;
  if (!execute) throw new Error("Missing reimbursement implementation");
  return contracts["fees.explainReimbursement"].output.parse(await execute(input, options));
}

afterEach(() => vi.unstubAllEnvs());

test.each([
  ["Akineton 2 mg Tabl.", "green", false],
  ["Mavenclad 10 mg Filmtabl.", "yellow_re1", true],
  ["Pentasa 1 g Zäpf.", "yellow_re2", false],
] as const)(
  "FR-M1 returns real administrative coverage for %s without enabling fixtures",
  async (name, box, approvalRequired) => {
    const result = await coverage(name);
    expect(result).toMatchObject({ listed: true, box, approvalRequired });
    expect(result.prescriptionFee).toContain("7,55 EUR");
    expect(result.prescriptionFee).toContain("2026");
    expect(result.capRule).toContain("Zwei Prozent");
    expect(result.capRule).toContain("314,01");
    expect(result.exemptionRule).toContain("Antrag");
    expect(result.exemptionRule).toContain("Gültigkeitsdatum ist nicht dokumentiert");
    expect(result.sources.some((source) => source.url.includes("medikament.txt"))).toBe(true);
    expect(result.sources.some((source) => source.quote.includes(name))).toBe(true);
    if (approvalRequired) expect(result.approvalRequestedBy).toContain("verordnende");
  },
);

test("FR-M1 keeps RE2 and green restrictions conditional without assessing eligibility", async () => {
  const re2 = await coverage("Pentasa 1 g Zäpf.");
  expect(re2.conditionsFlag).toBe(true);
  expect(re2.exemptionRule).toContain("nachfolgende Kontrolle");
  expect(re2.exemptionRule).toContain("außerhalb der Bedingungen");
  const green = await coverage("Bosulif 100 mg Filmtabl.");
  expect(green).toMatchObject({ box: "green", conditionsFlag: true });
  expect(green.approvalRequestedBy).toContain("verordnende");
});

test("FR-M1 preserves mixed pack statuses rather than choosing a box", async () => {
  const result = await coverage("Venobene Salbe");
  expect(result).toMatchObject({ listed: true, box: null, approvalRequired: true });
  expect(result.exemptionRule).toContain("unterscheidet sich zwischen Packungen");
  const quotes = result.sources.filter((source) => source.url.includes("medikament.txt"));
  expect(quotes).toHaveLength(2);
  expect(quotes.some((source) => source.quote.includes("RE1"))).toBe(true);
});

test("FR-M1 does exact product lookup, never suggests another product or infers a red box", async () => {
  const result = await coverage("Akineton");
  expect(result).toMatchObject({ listed: false, box: null, approvalRequired: false });
  expect(result.exemptionRule).toContain("weder eine rote Box noch eine Ablehnung");
  expect(JSON.stringify(result)).not.toContain("Akineton 2 mg");
  expect((await coverage("  AKINETON   2 mg Tabl. ")).listed).toBe(true);
  await expect(coverage("  ")).rejects.toThrow();
});

test("FR-M1 returns ATC-redacted rule quotes and no private indication dataset or price fields", async () => {
  const result = await coverage("Aldara 5 % Creme");
  const serialized = JSON.stringify(result);
  expect(serialized).toContain("[ATC-Code entfernt]");
  expect(serialized).not.toContain("D11AX18");
  expect(serialized).not.toMatch(/indtext|atccode|priceCents|registrationNumber/);
  const rules = result.sources.filter((source) => source.url.includes("regeltext.txt"));
  expect(rules.length).toBeGreaterThan(0);
});

test("FR-M2 explains the tariff basis, documents and self-submission without inventing an amount", async () => {
  const result = await reimbursement({});
  expect(result.illustrativeAmount).toBeNull();
  expect(result.illustrative).toBe(true);
  expect(result.ruleText).toContain("nicht 80 % der privaten Rechnung");
  expect(result.ruleText).toContain("höchstens die tatsächlichen Kosten");
  expect(result.ruleText).toContain("per Post");
  expect(result.ruleText).toContain("nehmen Sie selbst vor");
  expect(result.requiredDocuments.join(" ")).toMatch(/Honorarnote.*Zahlungsnachweis.*Überweisung/);
  expect(result.channels.onlineUrl).toBe("https://meine.oegk.at/");
}, 30000);

test("FR-M2 uses the real Styria euro tariff and returns its page, region and date", async () => {
  const result = await reimbursement({ tariffPositionId: "250" });
  expect(result).toMatchObject({
    illustrativeAmount: 18.41,
    illustrative: true,
    asOf: "2025-01-01",
  });
  expect(result.ruleText).toContain("23.01 EUR");
  expect(result.ruleText).toContain("Steiermark");
  expect(result.ruleText).toContain("unverbindlich");
  expect(result.sources).toContainEqual(
    expect.objectContaining({
      asOf: "2025-01-01",
      url: expect.stringContaining("#page=40"),
      quote: expect.stringContaining("23,01"),
    }),
  );
});

test.each([
  { tariffPositionId: "66" }, // KFA-only dental tariff: the ÖGK rule cannot be applied.
  { tariffPositionId: "1b" }, // BVAEB-only dental tariff.
  { tariffPositionId: "1" }, // Dental: multiple carriers with different rates.
  { tariffPositionId: "181" }, // Styria: several rate tiers.
  { tariffPositionId: "020" }, // Point tariff, no safe euro conversion.
  { tariffPositionId: "015" }, // Incomplete tariff component.
  { tariffPositionId: "not-a-published-position" },
  { tariffPositionId: "250", serviceDescription: "unrelated service" },
])("FR-M2 never chooses an ambiguous, mismatched or non-euro tariff: %j", async (input) => {
  expect((await reimbursement(input)).illustrativeAmount).toBeNull();
});

test("FR-M2 uses a uniquely identified dental tariff with its nationwide scope and 2026 date", async () => {
  const result = await reimbursement({ tariffPositionId: "IF" });
  expect(result).toMatchObject({
    illustrativeAmount: 53.92,
    asOf: "2026-01-01",
    illustrative: true,
  });
  expect(result.ruleText).toContain("Österreich");
  expect(result.ruleText).toContain("67.40 EUR");
  expect(result.sources.some((source) => source.url.includes("#page=30"))).toBe(true);
});

test("FR-M2 finds a service by the published description rather than inferring from a diagnosis", async () => {
  const result = await reimbursement({
    serviceDescription: "Versorgung einer Finger- oder Zehenfraktur",
  });
  expect(result.illustrativeAmount).toBe(18.41);
  expect(
    (await reimbursement({ serviceDescription: "Finger gebrochen" })).illustrativeAmount,
  ).toBeNull();
});

test("FR-M1 and FR-M2 fail closed with fixed errors when their real datasets are unavailable", async () => {
  vi.stubEnv("SVBOX_DIR", "/nonexistent/lotse-coverage-input");
  const unavailable = buildTools({ allowStubs: false });
  for (const [name, input, message] of [
    ["eko.lookupCoverage", { medicineNameExact: "Akineton 2 mg Tabl." }, "EKO_DATA_UNAVAILABLE"],
    ["fees.explainReimbursement", {}, "FEE_DATA_UNAVAILABLE"],
  ] as const) {
    const execute = unavailable[name].execute;
    if (!execute) throw new Error("Missing administrative implementation");
    await expect(execute(input, options)).rejects.toThrow(message);
  }
});
