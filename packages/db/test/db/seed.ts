import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../../src/db/client.ts";
import * as schema from "../../src/db/schema/index.ts";

export type Entity = { id: string; [key: string]: unknown };

// All synthetic content stays in tests; every insert uses the real database.
export async function seedEntities(db: DatabaseClient): Promise<Record<string, Entity>> {
  const ids = Object.fromEntries(
    [
      "user",
      "session",
      "subject",
      "case_actor",
      "profile",
      "case",
      "case_step",
      "approval",
      "message",
      "turn",
      "fact",
      "document",
      "benefit",
      "office",
      "facility",
      "process",
      "form_template",
      "form_instance",
      "source",
      "kb_chunk",
      "reminder",
      "job",
      "helper_session",
      "audit_event",
    ].map((table) => [table, randomUUID()]),
  );
  const identifier = (table: string) => {
    const value = ids[table];
    if (!value) throw new Error(`Missing id for ${table}`);
    return value;
  };
  const now = new Date();
  const approvalId = randomUUID();
  const fields = {
    name: {
      value: "Testperson",
      provenance: { factId: identifier("fact") },
      state: "draft" as const,
      approvalId: null,
    },
    region: {
      value: "Wien",
      provenance: { turnId: identifier("turn") },
      state: "confirmed" as const,
      approvalId,
    },
  };
  const uiMessage = {
    id: randomUUID(),
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Bitte helfen Sie beim Antrag." }],
  };
  const toolCalls = [{ id: randomUUID(), state: "completed" }];
  await db.insert(schema.users).values({ id: identifier("user") });
  await db.insert(schema.sessions).values({
    id: identifier("session"),
    userId: identifier("user"),
    clientKind: "web",
    expiresAt: new Date(now.getTime() + 3_600_000),
  });
  await db.insert(schema.subjects).values({
    id: identifier("subject"),
    displayName: "Testperson",
    relationToUser: "self",
    createdBy: identifier("user"),
  });
  await db.insert(schema.profiles).values({
    id: identifier("profile"),
    userId: identifier("user"),
    carrier: "Testträger",
    region: "Wien",
    ageBand: "adult",
  });
  await db.insert(schema.cases).values({
    id: identifier("case"),
    subjectId: identifier("subject"),
    confirmedGoal: "Antrag vorbereiten",
    lifeSituation: "administrative",
    journeyMap: [{ status: "pending" }],
  });
  await db.insert(schema.caseActors).values({
    id: identifier("case_actor"),
    caseId: identifier("case"),
    userId: identifier("user"),
    role: "subject",
    shareScope: { mode: "full" },
  });
  await db.insert(schema.caseSteps).values({
    id: identifier("case_step"),
    caseId: identifier("case"),
    processStep: "prepare",
    owner: "user",
    initiatedBy: "user",
    dueAt: now,
    linkedArtifacts: [{ documentId: identifier("document") }],
  });
  await db.insert(schema.approvals).values({
    id: identifier("approval"),
    approvalId,
    caseId: identifier("case"),
    toolCallId: randomUUID(),
    toolName: "form.commitGroup",
    inputHash: "a".repeat(64),
    actorId: identifier("case_actor"),
    sessionId: identifier("session"),
    decision: "approved",
    requestedAt: now,
    decidedAt: now,
    hmac: "b".repeat(64),
  });
  await db
    .insert(schema.messages)
    .values({ id: identifier("message"), caseId: identifier("case"), position: 0, uiMessage });
  await db.insert(schema.turns).values({
    id: identifier("turn"),
    caseId: identifier("case"),
    messageIds: [identifier("message")],
    capsuleDigest: "c".repeat(64),
    segments: [{ text: "Antrag vorbereiten" }],
    toolCalls,
    actionResults: [{ status: "completed" }],
    modelIds: { conversation: "test-model" },
    timings: { totalMs: 20 },
    status: "completed",
  });
  await db.insert(schema.documents).values({
    id: identifier("document"),
    subjectId: identifier("subject"),
    type: "letter",
    storageKey: `${identifier("document")}.pdf`,
    hash: "d".repeat(64),
    pages: [{ page: 1, text: "Name: Testperson", lines: [{ box: [0, 0, 1, 1] }] }],
    ocrStatus: "completed",
    originClient: "web",
  });
  await db.insert(schema.facts).values({
    id: identifier("fact"),
    subjectId: identifier("subject"),
    type: "identity.name",
    value: "Testperson",
    documentId: identifier("document"),
    source: { kind: "document", page: 1, bbox: [0, 0, 1, 1], quote: "Name: Testperson" },
    confidence: 1,
    confirmed: true,
  });
  await db.insert(schema.benefits).values({
    id: identifier("benefit"),
    key: randomUUID(),
    title: "Testleistung",
    category: "administrative",
    carrier: "Testträger",
    region: "Wien",
    record: { title: "Testleistung", version: 1 },
  });
  await db.insert(schema.offices).values({
    id: identifier("office"),
    key: randomUUID(),
    title: "Teststelle",
    carrier: "Testträger",
    region: "Wien",
    record: { address: "Testadresse" },
  });
  await db.insert(schema.facilities).values({
    id: identifier("facility"),
    key: randomUUID(),
    title: "Testeinrichtung",
    type: "service",
    region: "Wien",
    record: { accessible: true },
  });
  await db.insert(schema.processes).values({
    id: identifier("process"),
    key: randomUUID(),
    title: "Testablauf",
    benefitId: identifier("benefit"),
    record: { steps: [{ key: "prepare" }] },
  });
  await db.insert(schema.formTemplates).values({
    id: identifier("form_template"),
    publisher: "Testherausgeber",
    title: "Testformular",
    source: `https://example.org/${randomUUID()}.pdf`,
    hash: "e".repeat(64),
    versionDate: "2026-11-05",
    format: "flat",
    pages: 1,
    status: "auto",
    schema: { fields: [{ id: "name", type: "text", owner: "applicant" }] },
    storageKey: `${identifier("form_template")}.pdf`,
  });
  await db.insert(schema.formInstances).values({
    id: identifier("form_instance"),
    caseId: identifier("case"),
    subjectId: identifier("subject"),
    templateId: identifier("form_template"),
    fields,
    outputKey: `${identifier("form_instance")}.pdf`,
  });
  await db.insert(schema.sources).values({
    id: identifier("source"),
    url: "https://example.org/verwaltung",
    title: "Verwaltung",
    publisher: "Testherausgeber",
    text: "Information zur Rezeptgebühr.",
    metadata: { language: "de-AT" },
    validFrom: now,
  });
  await db.insert(schema.kbChunks).values({
    id: identifier("kb_chunk"),
    sourceId: identifier("source"),
    text: "Information zur Rezeptgebühr.",
    embedding: Array.from({ length: schema.embeddingDimensions }, (_, index) =>
      index === 0 ? 1 : 0,
    ),
    metadata: { page: 1 },
    validFrom: now,
  });
  await db.insert(schema.reminders).values({
    id: identifier("reminder"),
    caseId: identifier("case"),
    dueAt: now,
    source: { documentId: identifier("document"), quote: "Frist" },
  });
  await db.insert(schema.jobs).values({
    id: identifier("job"),
    caseId: identifier("case"),
    type: "prepare",
    stepState: { completed: ["first"] },
    attempts: 1,
  });
  await db.insert(schema.helperSessions).values({
    id: identifier("helper_session"),
    caseId: identifier("case"),
    helperId: identifier("user"),
    scope: { mode: "view" },
    startedAt: now,
  });
  await db.insert(schema.auditEvents).values({
    id: identifier("audit_event"),
    actorId: identifier("case_actor"),
    action: "approval.decided",
    target: { type: "case", id: identifier("case") },
    approvalId,
  });

  return {
    user: { id: identifier("user"), kind: "anonymous" },
    session: { id: identifier("session"), user_id: identifier("user"), client_kind: "web" },
    subject: {
      id: identifier("subject"),
      display_name: "Testperson",
      created_by: identifier("user"),
    },
    profile: {
      id: identifier("profile"),
      language: "de-AT",
      register: "formal",
      autonomy_level: "L1",
      carrier: "Testträger",
      region: "Wien",
      age_band: "adult",
    },
    case: {
      id: identifier("case"),
      subject_id: identifier("subject"),
      confirmed_goal: "Antrag vorbereiten",
      journey_map: [{ status: "pending" }],
    },
    case_actor: { id: identifier("case_actor"), role: "subject", share_scope: { mode: "full" } },
    case_step: {
      id: identifier("case_step"),
      process_step: "prepare",
      owner: "user",
      initiated_by: "user",
    },
    approval: {
      id: identifier("approval"),
      approval_id: approvalId,
      decision: "approved",
      input_hash: "a".repeat(64),
      hmac: "b".repeat(64),
    },
    message: { id: identifier("message"), position: 0, ui_message: uiMessage },
    turn: {
      id: identifier("turn"),
      message_ids: [identifier("message")],
      tool_calls: toolCalls,
      status: "completed",
    },
    document: {
      id: identifier("document"),
      type: "letter",
      ocr_status: "completed",
      origin_client: "web",
    },
    fact: {
      id: identifier("fact"),
      value: "Testperson",
      confidence: 1,
      confirmed: true,
      document_id: identifier("document"),
    },
    benefit: { id: identifier("benefit"), record: { title: "Testleistung", version: 1 } },
    office: { id: identifier("office"), record: { address: "Testadresse" } },
    facility: { id: identifier("facility"), record: { accessible: true } },
    process: {
      id: identifier("process"),
      benefit_id: identifier("benefit"),
      record: { steps: [{ key: "prepare" }] },
    },
    form_template: {
      id: identifier("form_template"),
      status: "auto",
      format: "flat",
      version_date: "2026-11-05",
    },
    form_instance: { id: identifier("form_instance"), fields },
    source: {
      id: identifier("source"),
      text: "Information zur Rezeptgebühr.",
      metadata: { language: "de-AT" },
    },
    kb_chunk: {
      id: identifier("kb_chunk"),
      text: "Information zur Rezeptgebühr.",
      metadata: { page: 1 },
    },
    reminder: {
      id: identifier("reminder"),
      source: { documentId: identifier("document"), quote: "Frist" },
    },
    job: { id: identifier("job"), step_state: { completed: ["first"] }, attempts: 1 },
    helper_session: {
      id: identifier("helper_session"),
      helper_id: identifier("user"),
      scope: { mode: "view" },
    },
    audit_event: {
      id: identifier("audit_event"),
      action: "approval.decided",
      approval_id: approvalId,
    },
  };
}
