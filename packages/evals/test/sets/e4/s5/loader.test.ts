import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { z } from "zod";
import { loadRubric, RubricSchema, scoreSchema } from "../../../../src/judge/index.ts";
import { PersonaSpecSchema } from "../../../../src/persona/index.ts";
import { selectCases } from "../../../../src/runner/index.ts";
import { CaseSchema, SourceSchema, SuiteSchema } from "../../../../src/schema/index.ts";

const directory = new URL("../../../../sets/e4/s5/", import.meta.url);
const repository = new URL("../../../../../../", import.meta.url);
const text = z.string().trim().min(1);
const evidence = z.array(text).min(1);
const statement = z.strictObject({ description: text, sources: evidence });
const reference = statement.extend({ catalogId: text.nullable() });
const document = statement.extend({
  key: text,
  status: z.enum(["have", "missing", "not_applicable"]),
  whereToObtain: text,
});
const factsSchema = z.strictObject({
  speaker: z.enum(["Maria", "Daniel"]),
  subject: z.strictObject({
    name: z.literal("Maria"),
    residence: text.nullable(),
    pensionPayer: text.nullable(),
    nationality: z.literal("Austrian"),
    firstApplication: z.literal(true),
    pensionPaidToAccount: z.literal(true),
    representative: z.literal(false),
    reports: z.enum(["available", "not_available"]),
  }),
  helper: z.strictObject({ name: z.literal("Daniel"), residence: text, healthInsurer: text }),
  session: z.strictObject({
    invite: z.enum(["valid", "expired"]),
    join: z.enum(["approved", "pending"]),
    shareScope: z.enum(["screen", "screen_case", "screen_case_selected_facts", "unknown"]),
    paused: z.boolean(),
  }),
  known: z.array(text).min(1),
  unresolved: z.array(text),
  answersWhenAsked: z.record(text, text),
});
const inputSchema = z.strictObject({
  opening: text,
  persona: PersonaSpecSchema,
  languageLevel: z.enum(["standard", "simple"]),
  channel: z.enum(["workspace", "voice_captions"]),
});
const expectedSchema = z.strictObject({
  completion: statement.extend({ mode: z.enum(["reviewed_draft", "safe_stop"]) }),
  goal: statement,
  benefits: z.array(reference).min(1),
  office: reference.extend({
    status: z.enum(["resolved", "needs_confirmation"]),
    afterClarification: reference.nullable(),
  }),
  form: reference,
  documents: z.array(document).length(5),
  questions: z.strictObject({
    minimum: z.number().int().nonnegative(),
    missing: z.array(text),
    countingRule: text,
    sources: evidence,
  }),
  nextAction: statement,
  language: statement.extend({ code: text, level: z.enum(["standard", "simple"]) }),
  citations: statement,
  boundary: statement,
  remote: statement,
  controls: statement.extend({
    approvalActor: z.literal("Maria"),
    helperMayApprove: z.literal(false),
    autoSubmit: z.literal(false),
    autoSign: z.literal(false),
    signatureFlag: z.literal("subject"),
  }),
  checkpoints: z.array(statement).min(1),
});
const sourceSchema = SourceSchema.extend({
  id: text,
  catalogId: text.optional(),
  page: z.number().int().positive().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

async function loadCases() {
  return z
    .array(CaseSchema)
    .parse(await readJson("cases.json"))
    .map((item) => ({
      ...item,
      input: inputSchema.parse(item.input),
      expected: expectedSchema.parse(item.expected),
    }));
}

test("remote help AC1 loads 20 unique harness cases with complete personas", async () => {
  const suite = SuiteSchema.parse(await readJson("suite.json"));
  expect(suite).toMatchObject({
    id: "E4",
    minimumSetSize: 300,
    gate: { kind: "informational", metric: "passRate", threshold: 0.9 },
  });
  const cases = await loadCases();
  expect(cases).toHaveLength(20);
  expect(new Set(cases.map((item) => item.id)).size).toBe(20);
  expect(new Set(cases.map((item) => item.input.opening)).size).toBe(20);
  for (const item of cases) {
    expect(item.kind).toBe("synthetic");
    expect(item.tags).toEqual(expect.arrayContaining(["synthetic", "nightly", "weekly"]));
    const { persona } = item.input;
    const facts = factsSchema.parse(persona.facts);
    expect(persona.goal.length).toBeGreaterThan(30);
    expect(persona.style.length).toBeGreaterThan(30);
    expect(persona.style).toContain(item.input.opening);
    expect(persona.region).toBe(facts.subject.residence ?? "Unknown; ask Maria");
    expect(persona.carrier).toBe(facts.subject.pensionPayer ?? "Unknown; ask Maria");
    expect(item.expected.language.code).toBe(persona.language);
    expect(item.expected.language.level).toBe(item.input.languageLevel);
  }
});

test("remote help AC1 covers language, register, helper, uncertainty and voice paths", async () => {
  const cases = await loadCases();
  for (const dimension of [
    "language:de-AT",
    "language:en",
    "simple_language",
    "dialect",
    "colloquial",
    "helper_asking",
    "missing_information",
    "contradictory_information",
    "voice_captions_only",
    "join_approval",
    "expired_invite",
    "scope_limit",
    "pause_sharing",
    "declined_action",
    "changed_input",
    "signature_request",
    "approval_rate_limit",
  ]) {
    expect(
      cases.some((item) => item.tags.includes(dimension)),
      dimension,
    ).toBe(true);
  }
  for (const language of ["de-AT", "en"]) {
    const localized = cases.filter((item) => item.input.persona.language === language);
    expect(localized.length).toBeGreaterThanOrEqual(4);
    expect(localized.some((item) => item.input.languageLevel === "simple")).toBe(true);
    expect(localized.some((item) => item.input.channel === "voice_captions")).toBe(true);
  }
  for (const item of cases) {
    const facts = factsSchema.parse(item.input.persona.facts);
    expect(item.tags).toContain(`language:${item.input.persona.language}`);
    expect(item.tags.includes("helper_asking")).toBe(facts.speaker === "Daniel");
    expect(item.tags.includes("simple_language")).toBe(item.input.languageLevel === "simple");
    expect(item.tags.includes("voice_captions_only")).toBe(item.input.channel === "voice_captions");
    if (item.tags.includes("contradictory_information")) {
      expect(item.expected.checkpoints.some((point) => point.sources.includes("facts"))).toBe(true);
      if (facts.subject.residence === null) {
        expect(facts.unresolved.length).toBeGreaterThan(0);
      } else {
        // A helper's proposal cannot turn an already confirmed residence into a missing fact.
        expect(item.expected.questions.minimum).toBe(0);
      }
    }
  }
  const pr = selectCases(z.array(CaseSchema).parse(await readJson("cases.json")), { subset: "pr" });
  expect(pr.length).toBeGreaterThanOrEqual(4);
  expect(pr.length).toBeLessThan(20);
  expect(pr.some((item) => item.tags.includes("language:en"))).toBe(true);
  expect(pr.some((item) => item.tags.includes("voice_captions_only"))).toBe(true);
  expect(pr.some((item) => item.tags.includes("join_approval"))).toBe(true);
});

test("remote help expectations ask only fixture prerequisites and preserve person approvals", async () => {
  for (const item of await loadCases()) {
    const facts = factsSchema.parse(item.input.persona.facts);
    const { expected } = item;
    expect(expected.questions.missing).toEqual(facts.unresolved);
    expect(expected.questions.minimum).toBe(facts.unresolved.length);
    expect(Object.keys(facts.answersWhenAsked).sort()).toEqual([...facts.unresolved].sort());
    expect(expected.documents.filter((entry) => entry.status === "have")).toHaveLength(
      facts.subject.reports === "available" ? 1 : 0,
    );
    expect(new Set(expected.documents.map((entry) => entry.key)).size).toBe(5);
    expect(expected.documents.filter((entry) => entry.status === "not_applicable")).toHaveLength(4);
    if (facts.subject.pensionPayer === null || facts.subject.residence === null) {
      expect(expected.office.catalogId).toBeNull();
      expect(expected.office.status).toBe("needs_confirmation");
      expect(expected.office.afterClarification?.catalogId).toBeTypeOf("string");
    } else {
      expect(expected.office.catalogId).not.toBeNull();
      expect(expected.office.status).toBe("resolved");
      expect(expected.office.afterClarification).toBeNull();
    }
    expect(expected.controls).toMatchObject({
      approvalActor: "Maria",
      helperMayApprove: false,
      autoSubmit: false,
      autoSign: false,
      signatureFlag: "subject",
    });
    expect(expected.controls.sources).toEqual(
      expect.arrayContaining(["roles", "approval_records", "form_filling", "subject_actor"]),
    );
    expect(expected.remote.sources).toEqual(expect.arrayContaining(["shared_voice", "cursor"]));
    expect(expected.completion.mode).toBe(
      item.tags.includes("pause_sharing") ? "safe_stop" : "reviewed_draft",
    );
  }
});

function sourceIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(sourceIds);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    key === "sources" ? evidence.parse(nested) : sourceIds(nested),
  );
}

test("every expectation resolves to quoted evidence and existing office records", async () => {
  const sources = z.array(sourceSchema).parse(await readJson("sources.json"));
  const byId = new Map(sources.map((source) => [source.id, source]));
  expect(byId.size).toBe(sources.length);
  for (const item of await loadCases()) {
    expect(SourceSchema.parse(item.source)).toEqual({
      uri: byId.get("scenario")?.uri,
      passage: byId.get("scenario")?.passage,
    });
    const used = sourceIds(item.expected);
    for (const id of used) expect(byId.has(id), id).toBe(true);
    const office = item.expected.office;
    for (const entry of [office, office.afterClarification]) {
      if (entry?.catalogId) {
        expect(entry.sources.some((id) => byId.get(id)?.catalogId === entry.catalogId)).toBe(true);
      }
    }
  }
  for (const source of sources.filter((entry) => entry.page === undefined)) {
    const uri = new URL(source.uri);
    expect(uri.protocol).toBe("file:");
    expect(uri.pathname.startsWith("/repo/")).toBe(true);
    const content = await readFile(
      new URL(uri.pathname.slice("/repo/".length), repository),
      "utf8",
    );
    expect(content, source.id).toContain(source.passage);
    if (source.catalogId) expect(content).toContain(`id: "${source.catalogId}"`);
  }
});

test("document expectations quote the original care allowance form at the declared pages", async () => {
  const sources = z.array(sourceSchema).parse(await readJson("sources.json"));
  const pdfSources = sources.filter((source) => source.page !== undefined);
  expect(pdfSources.length).toBeGreaterThanOrEqual(5);
  const svbox = resolve(fileURLToPath(repository), process.env.SVBOX_DIR ?? "data/svbox");
  const paths = new Set(pdfSources.map((source) => new URL(source.uri).pathname));
  expect(paths.size).toBe(1);
  const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
  for (const path of paths) {
    const bytes = await readFile(
      resolve(svbox, decodeURIComponent(path.split("/data/svbox/")[1] ?? "")),
    );
    const hash = createHash("sha256").update(bytes).digest("hex");
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
    try {
      const pdf = await loading.promise;
      for (const source of pdfSources.filter((entry) => new URL(entry.uri).pathname === path)) {
        expect(source.sha256).toBe(hash);
        const page = await pdf.getPage(source.page ?? 0);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
        expect(normalize(pageText), source.id).toContain(normalize(source.passage));
      }
    } finally {
      await loading.destroy();
    }
  }
});

test("remote help AC2 rubric uses all nine scenario criteria and complete score anchors", async () => {
  const rubric = RubricSchema.parse(await loadRubric(new URL("rubric.v1.yaml", directory)));
  expect(rubric.version).toBe("1");
  expect(rubric.criteria.map((criterion) => criterion.id).sort()).toEqual(
    [
      "goal_confirmed",
      "benefits",
      "office",
      "documents",
      "question_efficiency",
      "next_action",
      "tone_language",
      "citations",
      "boundary",
    ].sort(),
  );
  const scores = Object.fromEntries(
    rubric.criteria.map((criterion) => [
      criterion.id,
      {
        score: criterion.scale === "binary" ? 1 : 2,
        rationale: "Source-grounded expected behaviour observed.",
      },
    ]),
  );
  expect(scoreSchema(rubric).safeParse(scores).success).toBe(true);
  for (const criterion of rubric.criteria) {
    expect(Object.values(criterion.anchors).every((anchor) => anchor.length > 30)).toBe(true);
    expect(
      scoreSchema(rubric).safeParse({
        ...scores,
        [criterion.id]: { score: 3, rationale: "Out of range" },
      }).success,
    ).toBe(false);
  }
});
