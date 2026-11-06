// Runs against a migrated database with the catalog loaded (e.g. lotse_research); skipped otherwise.
// Expected gold values were checked by hand against packages/knowledge/catalog and processes YAML.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ResearchServer } from "../../src/research/server.ts";

const enabled = Boolean(process.env.DATABASE_URL);
let server: ResearchServer;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
async function gold(persona: unknown) {
  const result = await post("/gold", { persona });
  expect(result.status).toBe(200);
  return result.body as {
    warnings: string[];
    benefits: string[];
    offices: Record<string, string>;
    documents: Record<string, string[]>;
    min_questions: number;
    question_slots: string[];
    excluded: { benefitId: string; criteria: string[] }[];
    citations: { benefitId: string; criterionId: string; source: string; legalBasis?: string }[];
  };
}
const subject = (fields: Record<string, unknown>) => ({ role: "subject", ...fields });

describe.skipIf(!enabled)("research tool server", () => {
  beforeAll(async () => {
    const { startResearchServer } = await import("../../src/research/server.ts");
    server = await startResearchServer({ port: 0 });
  }, 30000);
  afterAll(async () => {
    await server?.stop();
  });

  it("serves health and a catalog summary with the persona vocabulary", async () => {
    const health = (await (await fetch(`${server.url}/health`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
    const summary = (await (await fetch(`${server.url}/catalog/summary`)).json()) as {
      benefits: { id: string }[];
      goals: { id: string; entry_slots: string[] }[];
      vocabulary: {
        states: string[];
        pension_carriers: string[];
        districts: Record<string, unknown[]>;
      };
    };
    expect(summary.benefits.map((item) => item.id)).toContain("pflegegeld");
    expect(summary.goals.find((goal) => goal.id === "pflegegeld")?.entry_slots.sort()).toEqual([
      "pension_source",
      "residence_region",
    ]);
    expect(summary.vocabulary.states).toHaveLength(9);
    expect(summary.vocabulary.pension_carriers).toEqual(["bvaeb", "pva", "svs"]);
    expect(summary.vocabulary.districts.Steiermark).toContain("Weiz");
  });

  it("gold 1: ASVG pensioner in Graz asking for Pflegegeld", async () => {
    const result = await gold({
      household: [
        subject({
          age: 74,
          sex: "f",
          residence: { state: "Steiermark", district: "Graz" },
          insurance: { carrier: "OEGK", status: "pensioner", pension_carrier: "PVA" },
          care: { pflegegeld_level: null, needs: ["mobility", "household"] },
          documents_held: ["e_card"],
        }),
        { role: "helper", age: 48, sex: "f" },
      ],
      situation_text: "Meine Mutter kommt allein nicht mehr zurecht.",
      goal: "pflegegeld",
    });
    // Vienna-only services fail their residence criterion; everything else in the bundle stays.
    expect(result.benefits).toContain("pflegegeld");
    expect(result.benefits).not.toContain("pflege-mobile-dienste-wien");
    expect(result.benefits).not.toContain("pflegeberatung-wien");
    expect(result.excluded.map((item) => item.benefitId).sort()).toEqual([
      "pflege-mobile-dienste-wien",
      "pflegeberatung-wien",
    ]);
    // pension_source == "asvg" and residence_region == "Steiermark" → PVA Landesstelle Steiermark.
    expect(result.offices.pflegegeld).toBe("pva-steiermark");
    expect(result.offices.pflegekarenz).toBe("sms-steiermark");
    expect(result.documents.pflegekarenz).toEqual(["agreement", "care-level"]);
    // The clarify step needs both slots and the opening statement names neither.
    expect(result.min_questions).toBe(2);
    expect(result.warnings).toEqual(["documents_held e_card is not a catalog document id"]);
    expect(
      result.citations.find(
        (item) => item.benefitId === "pflegegeld" && item.criterionId === "hours",
      )?.legalBasis,
    ).toContain("BPGG");
  });

  it("gold 2: GSVG pensioner in Vienna who names the state in the opening", async () => {
    const result = await gold({
      household: [
        subject({
          age: 81,
          sex: "m",
          residence: { state: "Wien", district: "10" },
          insurance: { carrier: "svs", status: "pensioner", pension_carrier: "svs" },
          care: { pflegegeld_level: 3 },
        }),
      ],
      situation_text: "Ich wohne in Wien und brauche Hilfe zu Hause.",
      goal: "pflegegeld",
    });
    expect(result.benefits).toEqual(
      expect.arrayContaining(["pflegegeld", "pflege-mobile-dienste-wien", "pflegeberatung-wien"]),
    );
    expect(result.excluded).toEqual([]);
    // pension_source == "gsvg-bsvg" → SVS head office; Vienna services → FSW.
    expect(result.offices.pflegegeld).toBe("svs-hauptstelle");
    expect(result.offices["pflege-mobile-dienste-wien"]).toBe("fsw-pflege-und-betreuung-1150");
    expect(result.documents["pflege-mobile-dienste-wien"]).toEqual([
      "photo-id",
      "citizenship",
      "income",
      "rent",
    ]);
    expect(result.question_slots).toEqual(["pension_source"]);
    expect(result.min_questions).toBe(1);
  });

  it("gold 3: woman aged 55 in the prevention bundle", async () => {
    const result = await gold({
      household: [
        subject({
          age: 55,
          sex: "f",
          residence: { state: "Wien" },
          insurance: { carrier: "OEGK", status: "employed" },
        }),
      ],
      situation_text: "Ich möchte zur Mammographie.",
      goal: "praevention-brustkrebs-frueherkennung",
    });
    // Target groups: screening 45–74 female, opt-in 40–44 and 75+, vaccination programme 60+.
    expect(result.benefits).toContain("praevention-brustkrebs-frueherkennung");
    expect(result.benefits).toContain("praevention-vorsorgeuntersuchung");
    expect(result.excluded.map((item) => item.benefitId).sort()).toEqual([
      "praevention-brustkrebs-opt-in-aelter",
      "praevention-brustkrebs-opt-in-jung",
      "praevention-impfprogramm-ab-60",
    ]);
    expect(result.documents["praevention-brustkrebs-frueherkennung"]).toEqual(["e-card"]);
    expect(
      result.citations.some(
        (item) =>
          item.benefitId === "praevention-brustkrebs-frueherkennung" &&
          item.criterionId === "praevention-brustkrebs-frueherkennung:sex",
      ),
    ).toBe(true);
  });

  it("gold 4: man aged 50 is excluded from breast cancer screening by sex", async () => {
    const result = await gold({
      household: [
        subject({
          age: 50,
          sex: "m",
          residence: { state: "Tirol" },
          insurance: { carrier: "OEGK", status: "employed" },
        }),
      ],
      situation_text: "Welche Vorsorge steht mir zu?",
      goal: "praevention-vorsorgeuntersuchung",
    });
    expect(result.benefits).toContain("praevention-darmkrebs-frueherkennung");
    expect(result.benefits).not.toContain("praevention-brustkrebs-frueherkennung");
    expect(
      result.excluded.find((item) => item.benefitId === "praevention-brustkrebs-frueherkennung")
        ?.criteria,
    ).toEqual(["praevention-brustkrebs-frueherkennung:sex"]);
  });

  it("gold 5: low income in Weiz resolves the district authority", async () => {
    const result = await gold({
      household: [
        subject({
          age: 40,
          sex: "d",
          residence: { state: "Steiermark", district: "Weiz" },
          insurance: { carrier: "OEGK", status: "none" },
        }),
      ],
      situation_text: "Ich habe kaum Einkommen.",
      goal: "sozialhilfe-steiermark",
      opening_facts: ["residence.state"],
    });
    expect(result.benefits).toContain("sozialhilfe-steiermark");
    expect(result.excluded).toEqual([
      { benefitId: "sozialhilfe-wien", criteria: ["residence-vienna"] },
    ]);
    // federal_state == 'Steiermark' and district == 'Weiz' → BH Weiz.
    expect(result.offices["sozialhilfe-steiermark"]).toBe("bh-weiz");
    expect(result.documents["sozialhilfe-steiermark"]).toEqual([
      "identification-and-residence",
      "asset-evidence",
    ]);
    // clarify-situation needs four slots; the opening states the federal state.
    expect(result.question_slots).toEqual([
      "main_residence_confirmed",
      "actual_residence_confirmed",
      "residence_status",
    ]);
  });

  it("rejects unknown goals and invalid personas", async () => {
    expect(
      (await post("/gold", { persona: { household: [subject({})], goal: "nope" } })).status,
    ).toBe(400);
    expect((await post("/gold", { persona: { goal: "pflegegeld" } })).status).toBe(400);
  });

  it("runs real tools with their contracts and the product's process flow", async () => {
    expect((await post("/tools/catalog.getBenefit", { benefitId: 1 })).status).toBe(400);
    expect((await post("/tools/nope.tool", {})).status).toBe(404);
    expect((await post("/tools/kb.search", { query: "x", filters: {}, k: 1 })).status).toBe(501);
    const office = await post("/tools/office.resolve", {
      benefitId: "pflegegeld",
      carrier: "oegk",
      subjectStatus: "pensioner:pva",
      region: "Steiermark",
    });
    expect(office.body.id).toBe("pva-steiermark");
    const episode = (await post("/episodes", {})).body as { caseId: string; subjectId: string };
    const headers = { "x-research-case": episode.caseId };
    expect(
      (
        await post(
          "/tools/process.start",
          { caseId: episode.caseId, benefitId: "pflegegeld" },
          headers,
        )
      ).body.error,
    ).toBe("GOAL_CONFIRMATION_REQUIRED");
    await post(
      "/tools/case.update",
      { caseId: episode.caseId, patch: { confirmedGoal: "Pflegegeld beantragen" } },
      headers,
    );
    const started = await post(
      "/tools/process.start",
      { caseId: episode.caseId, benefitId: "pflegegeld" },
      headers,
    );
    expect(started.status).toBe(200);
    const next = await post("/tools/process.nextStep", { caseId: episode.caseId }, headers);
    expect((next.body.missingSlots as string[]).sort()).toEqual([
      "pension_source",
      "residence_region",
    ]);
    const applied = await post(
      "/tools/process.applyAnswers",
      { caseId: episode.caseId, answers: [{ id: "residence_region", value: "Steiermark" }] },
      headers,
    );
    expect((applied.body.state as { firstMissingSlot: string }).firstMissingSlot).toBe(
      "pension_source",
    );
    const checklist = await post(
      "/tools/documents.checklist",
      { benefitId: "pflegekarenz", subjectId: episode.subjectId },
      headers,
    );
    expect((checklist.body as unknown as { type: string }[]).map((item) => item.type)).toEqual([
      "agreement",
      "care-level",
    ]);
  });
});
