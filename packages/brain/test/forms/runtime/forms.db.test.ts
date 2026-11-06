import { createHash, randomUUID } from "node:crypto";
import {
  benefits,
  facts,
  formInstances,
  formTemplates,
  messages,
  subjects,
  turns,
} from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { JsonObjectSchema } from "@lotse/protocol";
import { eq } from "drizzle-orm";
import { PDFDocument, PDFTextField } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RuntimeContext } from "../../../src/agent/context.ts";
import { createApprovalService } from "../../../src/approvals/index.ts";
import { DIRECTORY_CONFIG } from "../../../src/config/index.ts";
import { resolveContext } from "../../../src/conversation/store.ts";
import { officialOrigins } from "../../../src/forms/acquire/http.ts";
import { acquireForm } from "../../../src/forms/acquire/index.ts";
import { detectFields } from "../../../src/forms/detect/index.ts";
import { commitFormGroup, fillLiveForm, prefillForm } from "../../../src/forms/instances/index.ts";
import {
  buildFormPackage,
  buildFormPackageForSession,
  downloadFormPdf,
} from "../../../src/forms/output/index.ts";
import { packageLetter } from "../../../src/forms/output/letter.ts";
import { analyzeTemplate, getTemplate } from "../../../src/forms/registry/index.ts";
import { templateSchema } from "../../../src/forms/schema.ts";
import type { ToolDependencies } from "../../../src/tools/types.ts";
import { config, identity, isolatedDatabase, turn } from "../../runtime/helpers.ts";
import { formNames, readForm } from "../detect/fixtures.ts";

describe("FR-D5/6/10 real Postgres and MinIO form lifecycle", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  let context: RuntimeContext;
  let bytes: Uint8Array;
  let templateId: string;
  let selected: string[];
  let formInstanceId: string;
  const keys: string[] = [];
  const previousPrefix = process.env.S3_PREFIX;

  beforeAll(async () => {
    database = await isolatedDatabase();
    process.env.S3_PREFIX = `forms-test-${randomUUID()}`;
    const session = await identity(database.db);
    context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    const turnId = randomUUID();
    await database.db
      .insert(turns)
      .values({ id: turnId, caseId: context.caseId, status: "running" });
    for (const name of await formNames()) {
      const candidate = await readForm(name);
      if (
        !(await PDFDocument.load(candidate))
          .getForm()
          .getFields()
          .some((field) => field instanceof PDFTextField)
      )
        continue;
      bytes = candidate;
      const detected = await detectFields(bytes, { mode: "acroform", vision: "disabled" });
      selected = detected.fields
        .filter(
          (field) =>
            field.owner === "applicant" &&
            field.type === "text" &&
            !detected.fields.some(
              (other) =>
                other.acro_field === field.acro_field &&
                (other.owner !== "applicant" ||
                  other.signature !== "none" ||
                  other.type === "signature"),
            ),
        )
        .slice(0, 2)
        .map((field) => field.id);
      if (selected.length !== 2) continue;
      templateId = randomUUID();
      // The two administrative mappings and facts are test-only, derived from real detected fields.
      const schema = JsonObjectSchema.parse(
        JSON.parse(
          JSON.stringify({
            ...detected,
            templateId,
            fields: detected.fields.map((field) => ({
              ...field,
              page: field.box.page,
              validation: {},
              ...(selected.includes(field.id)
                ? { fact_type: `test.slot.${selected.indexOf(field.id)}` }
                : {}),
            })),
          }),
        ),
      );
      await database.db.insert(formTemplates).values({
        id: templateId,
        publisher: "SV-Box",
        title: name,
        source: `data/svbox/Anträge und Formulare/${name}`,
        hash: createHash("sha256").update(bytes).digest("hex"),
        format: "acroform",
        pages: detected.pages.length,
        schema,
        storageKey: "unused-local-original",
      });
      for (const [index] of selected.entries())
        await database.db.insert(facts).values({
          subjectId: context.subjectId,
          type: `test.slot.${index}`,
          value: `Beispiel ${index}`,
          turnId,
          source: { kind: "statement", turnId, quote: `Meine Angabe: Beispiel ${index}` },
          confidence: 1,
          confirmed: true,
        });
      break;
    }
    if (!templateId) throw new Error("No suitable official form");
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (database) {
      const storage = createObjectStorage();
      try {
        for (const key of keys) await storage.delete(key);
      } finally {
        storage.close();
      }
      await database.cleanup();
    }
    if (previousPrefix === undefined) delete process.env.S3_PREFIX;
    else process.env.S3_PREFIX = previousPrefix;
  });

  it("persists proposals as drafts and emits one paced, provenance-bearing action per field", async () => {
    const proposed = await prefillForm(
      database.db,
      { templateId, caseId: context.caseId, subjectId: context.subjectId },
      context,
    );
    formInstanceId = proposed.formInstanceId;
    expect(proposed.proposals).toHaveLength(2);
    const parts: unknown[] = [];
    const deps: ToolDependencies = {
      allowStubs: false,
      db: database.db,
      writer: {
        write: (part) => {
          parts.push(part);
        },
      },
    };
    const actions = await fillLiveForm(
      database.db,
      deps,
      { formInstanceId, fieldIds: selected, pace: 85 },
      context,
    );
    expect(actions.actionIds).toHaveLength(2);
    expect(parts).toEqual(
      selected.map((id, index) =>
        expect.objectContaining({
          type: "data-action",
          data: expect.objectContaining({
            kind: "type",
            target: { kind: "form", formInstanceId, fieldId: id },
            payload: expect.objectContaining({
              pace: 85,
              value: `Beispiel ${index}`,
              provenance: expect.objectContaining({ factId: expect.any(String) }),
            }),
          }),
        }),
      ),
    );
    const [instance] = await database.db
      .select()
      .from(formInstances)
      .where(eq(formInstances.id, formInstanceId));
    expect(Object.values(instance?.fields ?? {}).map((field) => field.state)).toEqual([
      "draft",
      "draft",
    ]);
    const [withdrawn] = await database.db
      .select()
      .from(facts)
      .where(eq(facts.subjectId, context.subjectId))
      .limit(1);
    if (!withdrawn) throw new Error("Missing confirmed fact");
    await database.db.update(facts).set({ confirmed: false }).where(eq(facts.id, withdrawn.id));
    await expect(
      fillLiveForm(database.db, deps, { formInstanceId, fieldIds: selected }, context),
    ).rejects.toThrow("FORM_INVALID_FIELDS");
    expect(parts).toHaveLength(2);
    await database.db.update(facts).set({ confirmed: true }).where(eq(facts.id, withdrawn.id));
    const source = templateSchema(await getTemplate(database.db, templateId)).fields.find(
      (field) => field.id === selected[0],
    );
    if (!source?.acro_field) throw new Error("Missing original widget");
    const exported = await PDFDocument.load(
      await downloadFormPdf(database.db, context.userId, formInstanceId),
    );
    expect(exported.getForm().getTextField(source.acro_field).getText()).toBeUndefined();
    await expect(
      fillLiveForm(
        database.db,
        deps,
        { formInstanceId, fieldIds: selected },
        { ...context, autonomyLevel: "L1" },
      ),
    ).rejects.toThrow("FORM_ACCESS_DENIED");
  });

  it("requires the existing signed approval flow, binds exact input and rejects replay", async () => {
    const fieldId = selected[0];
    if (!fieldId) throw new Error("Missing selected field");
    const input = { formInstanceId, fieldIds: [fieldId], values: { [fieldId]: "Beispiel 0" } };
    const toolCallId = randomUUID();
    const call = { toolCallId, approvalId: randomUUID(), toolName: "form.commitGroup", input };
    const approvals = createApprovalService(database.db, config.approvalSecret);
    await expect(commitFormGroup(database.db, input, context, toolCallId)).rejects.toThrow(
      "FORM_APPROVAL_REQUIRED",
    );
    await approvals.request(call, context);
    await expect(commitFormGroup(database.db, input, context, toolCallId)).rejects.toThrow(
      "FORM_APPROVAL_REQUIRED",
    );
    await database.db.transaction((tx) => approvals.decide(tx, call, context, true));
    await expect(
      commitFormGroup(
        database.db,
        { ...input, values: { [fieldId]: "Changed after approval" } },
        context,
        toolCallId,
      ),
    ).rejects.toThrow("FORM_APPROVAL_REQUIRED");
    expect(await commitFormGroup(database.db, input, context, toolCallId)).toEqual({
      values: input.values,
      approvalId: call.approvalId,
    });
    await expect(commitFormGroup(database.db, input, context, toolCallId)).rejects.toThrow(
      "FORM_APPROVAL_REQUIRED",
    );
    // Synthetic catalog linkage and persisted office result exercise personalised output
    // independently of a particular benefit or office in the challenge catalog.
    const benefitKey = randomUUID();
    await database.db.insert(benefits).values({
      key: benefitKey,
      title: "Testantrag",
      category: "test",
      record: {
        forms: [`ref:forms/${templateId}`],
        documents: [
          { name_de: "Nachweis", required: true },
          { name_de: "Optionaler Nachweis", required: false },
        ],
      },
    });
    await database.db
      .update(subjects)
      .set({ displayName: "Ada Beispiel" })
      .where(eq(subjects.id, context.subjectId));
    await database.db.insert(messages).values({
      caseId: context.caseId,
      position: 0,
      uiMessage: {
        id: randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "office.resolve",
            toolCallId: randomUUID(),
            state: "output-available",
            input: { benefitId: benefitKey, carrier: "test", subjectStatus: "test", region: "AT" },
            output: {
              id: randomUUID(),
              title: "Teststelle",
              address: { street: "Testgasse 1", postalCode: "1000", city: "Testort" },
              channels: {},
              openingHours: "",
              sources: [],
            },
          },
        ],
      },
    });
    const built = await buildFormPackageForSession(
      database.db,
      { userId: context.userId, sessionId: context.sessionId, kind: "anonymous" },
      formInstanceId,
    );
    keys.push(built.pdfKey);
    expect(built.attachmentChecklist).toEqual(["Nachweis"]);
    expect(built.coverLetter).toContain("Ada Beispiel");
    expect(built.coverLetter).toContain("Teststelle\nTestgasse 1\n1000 Testort");
    expect(built.coverLetter).toContain("Nachweis");
    expect(built.coverLetter).not.toContain("Optionaler Nachweis");
    expect(built.coverLetter).toContain(
      new Intl.DateTimeFormat("de-AT", {
        timeZone: DIRECTORY_CONFIG.timeZone,
        dateStyle: "long",
      }).format(new Date()),
    );
    const storage = createObjectStorage();
    try {
      const pdf = await PDFDocument.load(await storage.get(built.pdfKey));
      const schema = templateSchema(await getTemplate(database.db, templateId));
      for (const [index, id] of selected.entries()) {
        const field = schema.fields.find((field) => field.id === id);
        if (!field?.acro_field) throw new Error("Missing original widget");
        expect(pdf.getForm().getTextField(field.acro_field).getText()).toBe(
          index === 0 ? "Beispiel 0" : undefined,
        );
      }
    } finally {
      storage.close();
    }
  });

  it("FR-D6 package HTTP entry point denies unrelated users and helpers before writing output", async () => {
    await expect(
      buildFormPackageForSession(
        database.db,
        {
          userId: randomUUID(),
          sessionId: randomUUID(),
          kind: "anonymous",
        },
        formInstanceId,
      ),
    ).rejects.toThrow("FORM_ACCESS_DENIED");
    await expect(
      buildFormPackage(
        database.db,
        { caseId: context.caseId, formInstanceId },
        {
          ...context,
          actorRole: "helper",
        },
      ),
    ).rejects.toThrow("FORM_ACCESS_DENIED");
  });

  it("FR-D10 candidate approval shows publisher, title, date and URL without registering on refusal", async () => {
    const [origin] = await officialOrigins();
    if (!origin) throw new Error("Missing allowlist");
    const url = `${origin}/forms/${randomUUID()}.pdf`;
    const candidate = {
      publisher: "Offizieller Herausgeber",
      title: "Verwaltungsantrag",
      versionDate: "2026-01-15",
      url,
      format: "flat",
    };
    await database.db.insert(messages).values({
      caseId: context.caseId,
      position: 1,
      uiMessage: {
        id: randomUUID(),
        role: "assistant",
        parts: [
          {
            type: "tool-form.find",
            toolCallId: randomUUID(),
            state: "output-available",
            input: { need: candidate.title },
            output: [candidate],
          },
        ],
      },
    });
    const fetcher = vi.fn(() => {
      throw new Error("No download before consent");
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const service = createApprovalService(database.db, config.approvalSecret);
      const call = {
        approvalId: randomUUID(),
        toolCallId: randomUUID(),
        toolName: "form.acquire",
        input: { url },
      };
      const approval = await service.request(call, context);
      expect(approval.summary).toContain(candidate.publisher);
      expect(approval.summary).toContain(candidate.title);
      expect(approval.summary).toContain(candidate.versionDate);
      expect(approval.summary).toContain(url);
      await database.db.transaction((tx) => service.decide(tx, call, context, false));
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        await database.db.select().from(formTemplates).where(eq(formTemplates.source, url)),
      ).toEqual([]);
      await expect(
        database.db.transaction((tx) => service.decide(tx, call, context, true)),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("E7 preserves JSON string facts including leading zeros and JSON-looking text", async () => {
    const [original] = await database.db
      .select()
      .from(facts)
      .where(eq(facts.subjectId, context.subjectId))
      .limit(1);
    if (!original) throw new Error("Missing synthetic source fact");
    const schema = templateSchema(await getTemplate(database.db, templateId));
    const field = schema.fields.find((entry) => entry.fact_type === original.type);
    if (!field) throw new Error("Missing administrative mapping");
    try {
      for (const value of ["1234", "00001234", "false", "null", "[1,2]", '"quoted"']) {
        await database.db.update(facts).set({ value }).where(eq(facts.id, original.id));
        const result = await prefillForm(
          database.db,
          { templateId, caseId: context.caseId, subjectId: context.subjectId },
          context,
        );
        expect(result.proposals.find((proposal) => proposal.fieldId === field.id)?.value).toBe(
          value,
        );
      }
    } finally {
      await database.db
        .update(facts)
        .set({ value: original.value })
        .where(eq(facts.id, original.id));
    }
  });

  it("persists an approved correction as a user-statement fact and denies other users", async () => {
    const fieldId = selected[0];
    if (!fieldId) throw new Error("Missing selected field");
    const input = {
      formInstanceId,
      fieldIds: [fieldId],
      values: { [fieldId]: "Korrigierte Angabe" },
    };
    const call = {
      toolCallId: randomUUID(),
      approvalId: randomUUID(),
      toolName: "form.commitGroup",
      input,
    };
    const approvals = createApprovalService(database.db, config.approvalSecret);
    await approvals.request(call, context);
    await database.db.transaction((tx) => approvals.decide(tx, call, context, true));
    await commitFormGroup(database.db, input, context, call.toolCallId);
    const saved = await database.db
      .select()
      .from(facts)
      .where(eq(facts.subjectId, context.subjectId));
    expect(saved.find((fact) => fact.value === "Korrigierte Angabe")).toMatchObject({
      confirmed: true,
      source: { kind: "statement", quote: "Korrigierte Angabe" },
    });
    await expect(downloadFormPdf(database.db, randomUUID(), formInstanceId)).rejects.toThrow(
      "FORM_ACCESS_DENIED",
    );
  });

  it("reuses known official bytes, stores originals in MinIO and runs real field detection", async () => {
    const url = `https://www.oegk.at/forms/${randomUUID()}.pdf`;
    // Isolated HTTP double only: official site variability must not affect DB/storage acceptance.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf" } }),
      ),
    );
    try {
      const acquired = await acquireForm(database.db, url);
      keys.push(acquired.storageKey);
      const again = await acquireForm(database.db, url);
      expect(again.id).toBe(acquired.id);
      // A dynamic catalog hint is connected only by its persisted official search result.
      const search = `Administrative form ${randomUUID()}`;
      const benefitKey = randomUUID();
      await database.db.insert(benefits).values({
        key: benefitKey,
        title: search,
        category: "test",
        record: {
          forms: [{ search, publisher: acquired.publisher }],
          documents: [{ name_de: "Dynamischer Nachweis", required: true }],
        },
      });
      await database.db.insert(messages).values({
        caseId: context.caseId,
        position: 2,
        uiMessage: {
          id: randomUUID(),
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "form.find",
              toolCallId: randomUUID(),
              state: "output-available",
              input: { need: search },
              output: [
                {
                  title: acquired.title,
                  publisher: acquired.publisher,
                  url,
                  versionDate: null,
                  format: acquired.format,
                },
              ],
            },
            {
              type: "tool-office.resolve",
              toolCallId: randomUUID(),
              state: "output-available",
              input: {
                benefitId: benefitKey,
                carrier: "test",
                subjectStatus: "test",
                region: "AT",
              },
              output: {
                id: randomUUID(),
                title: "Andere Teststelle",
                address: { street: "Weg 2", postalCode: "1000", city: "Testort" },
                channels: {},
                openingHours: "",
                sources: [],
              },
            },
          ],
        },
      });
      const letter = await packageLetter(database.db, acquired, context);
      expect(letter.attachmentChecklist).toEqual(["Dynamischer Nachweis"]);
      expect(letter.coverLetter).toContain("Andere Teststelle");
      expect(letter.coverLetter).not.toContain("Testgasse 1");
      expect(templateSchema(acquired).fields.length).toBeGreaterThan(0);
      const analyzed = await analyzeTemplate(database.db, acquired);
      expect(analyzed.fields.length).toBeGreaterThan(0);
      const storage = createObjectStorage();
      try {
        expect(await storage.get(acquired.storageKey)).toEqual(Buffer.from(bytes));
      } finally {
        storage.close();
      }
      const changed = await PDFDocument.load(bytes);
      changed.setSubject("Test-only next published version");
      const versionBytes = await changed.save();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Uint8Array(versionBytes))),
      );
      const next = await acquireForm(database.db, url);
      keys.push(next.storageKey);
      expect(next.id).not.toBe(acquired.id);
      expect(next.hash).not.toBe(acquired.hash);
      expect((await getTemplate(database.db, acquired.id)).hash).toBe(acquired.hash);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
