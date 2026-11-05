import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

export const source = {
  url: "https://example.org/administration",
  quote: "Anträge können bei der zuständigen Stelle eingebracht werden.",
  retrieved_at: "2026-11-01T12:00:00Z",
};
export const provenance = { sources: [source], as_of: "2026-11-01", verified_at: "2026-11-02" };
export const benefit = {
  id: "fixture-benefit",
  name_de: "Antrag",
  name_simple: "Antrag stellen",
  area: "A",
  life_situations: ["fixture-situation", "fixture_situation"],
  scope: "social_insurance",
  carriers: ["oegk"],
  criteria: [
    {
      id: "residence",
      text_de: "Wohnsitz angegeben",
      condition: 'residence.state == "Wien"',
      legal_basis: "§ 1 Beispiel",
      source,
    },
  ],
  office_rules: [{ when: "age >= 18 and not retired", office: "ref:offices/fixture-office" }],
  documents: [
    {
      id: "identity",
      name_de: "Identitätsnachweis",
      required: true,
      obtain_from: "Meldebehörde",
      source,
    },
  ],
  forms: ["ref:forms/fixture-form", { search: "Antrag", publisher: "Träger" }],
  process: "ref:processes/fixture-process",
  appointment_channels: [{ kind: "phone", number: "+43123456", verified_at: "2026-11-02" }],
  ...provenance,
};
export const processRecord = {
  id: "fixture-process",
  benefit: "ref:catalog/fixture-benefit",
  actor_roles: ["subject", "helper"],
  slots: [{ id: "age", type: "number", question_hint: "Wie alt sind Sie?" }],
  steps: [
    {
      id: "prepare",
      needs: ["age"],
      criteria: "ref:catalog/fixture-benefit#criteria",
      documents: "ref:catalog/fixture-benefit#documents",
      form: "ref:forms/fixture-form",
      signature: "subject",
      on_complete: ["process.nextStep"],
      outputs: [{ id: "application", type: "document" }],
      reminders: [{ after_days: 7, text_de: "Unterlagen prüfen" }],
      transitions: [{ to: "finish", when: "age >= 18" }],
    },
    { id: "finish", needs: ["prepare"] },
  ],
  completion: { evidence: ["user_statement", "artefact_built"] },
  ...provenance,
};
export const office = {
  id: "fixture-office",
  name_de: "Servicestelle",
  carrier: "oegk",
  region: "Wien",
  address: { street: "Beispielstraße 1", postal_code: "1010", locality: "Wien", country: "AT" },
  ...provenance,
};
export const facility = {
  id: "fixture-facility",
  name_de: "Beratungszentrum",
  type: "counselling",
  region: "Wien",
  office: "ref:offices/fixture-office",
  ...provenance,
};
export const form = {
  id: "fixture-form",
  template_id: "b508cc7c-bfb0-4f73-893d-ae85a8e73c56",
  status: "verified",
  fields: [
    {
      id: "name",
      label_de: "Name",
      labels: { en: "Name" },
      help_text: "Name der antragstellenden Person",
      type: "text",
      validation: { required: true },
      fact_type: "person.name",
      acro_field: "Name",
      owner: "applicant",
      signature: "none",
    },
  ],
  ...provenance,
};
export const allowlist = {
  origins: [{ origin: "https://example.org", purpose: "Official administration" }],
  ...provenance,
};
export const records: Record<string, unknown> = {
  "catalog/benefit.yaml": benefit,
  "processes/process.yaml": processRecord,
  "offices/nested/office.yml": office,
  "facilities/facility.yaml": facility,
  "forms/form.json": form,
  "allowlist.yaml": allowlist,
  "sources.yaml": { sources: [source], as_of: "2026-11-01" },
};
export async function fixtureRoot(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "lotse-knowledge-"));
  for (const [path, record] of Object.entries({ ...records, ...overrides })) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(
      join(root, path),
      path.endsWith(".json") ? JSON.stringify(record) : stringify(record),
    );
  }
  return root;
}
export const removeFixture = (root: string) => rm(root, { recursive: true, force: true });
