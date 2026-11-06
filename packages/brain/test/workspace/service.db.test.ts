import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  benefits,
  caseSteps,
  cases,
  documents,
  facilities,
  formInstances,
  formTemplates,
  messages,
  processes,
  subjects,
  users,
} from "@lotse/db/schema";
import { JsonObjectSchema } from "@lotse/protocol";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parse } from "yaml";
import { createWorkspaceService, prepareWorkspaceAppointment } from "../../src/workspace/index.ts";
import {
  checklistBenefitRecord,
  directoryRecord,
  workspaceProcessRecord,
} from "../../src/workspace/records.ts";
import { isolatedDatabase } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
const owner = randomUUID();
const outsider = randomUUID();
const subjectId = randomUUID();
const caseId = randomUUID();
const stepId = randomUUID();
const benefit = checklistBenefitRecord.parse(
  parse(
    await readFile(
      new URL("../../../knowledge/catalog/medical-rehabilitation.yaml", import.meta.url),
      "utf8",
    ),
  ),
);
const facility = directoryRecord.parse(
  parse(
    await readFile(
      new URL("../../../knowledge/facilities/auva-rz-meidling.yaml", import.meta.url),
      "utf8",
    ),
  ),
);
const process = workspaceProcessRecord.parse(
  parse(
    await readFile(
      new URL("../../../knowledge/processes/medical-rehabilitation.yaml", import.meta.url),
      "utf8",
    ),
  ),
);

beforeAll(async () => {
  database = await isolatedDatabase();
  await database.db.insert(users).values([{ id: owner }, { id: outsider }]);
  await database.db
    .insert(subjects)
    .values({ id: subjectId, createdBy: owner, displayName: "Testperson", relationToUser: "self" });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "Verwaltungsunterlagen vorbereiten" });
  await database.db
    .insert(benefits)
    .values({ key: benefit.id, title: benefit.name_de, category: "A", record: benefit });
  await database.db
    .insert(processes)
    .values({ key: process.id, title: process.id, record: JsonObjectSchema.parse(process) });
  await database.db.insert(facilities).values({
    key: facility.id,
    title: facility.name_de,
    type: facility.type,
    record: JsonObjectSchema.parse(facility),
  });
  const firstStep = process.steps[0];
  const firstDocument = benefit.documents[0];
  if (!firstStep || !firstDocument) throw new Error("Missing source fixture");
  await database.db.insert(caseSteps).values({
    id: stepId,
    caseId,
    processStep: firstStep.id,
    owner: "pilot",
    initiatedBy: "pilot",
    status: "in_progress",
  });
  await database.db.insert(documents).values({
    subjectId,
    type: firstDocument.id,
    storageKey: randomUUID(),
    hash: "test-hash",
    ocrStatus: "completed",
    originClient: "web",
  });
  await database.db.insert(messages).values({
    caseId,
    position: 0,
    uiMessage: {
      id: randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "data-case-event",
          data: { caseId, kind: "step_completed", payload: { stepId } },
        },
      ],
    },
  });
  await database.db.insert(messages).values({
    caseId,
    position: 1,
    uiMessage: {
      id: randomUUID(),
      role: "user",
      parts: [
        {
          type: "data-case-event",
          data: {
            caseId,
            kind: "step_created",
            payload: { stepId: "test-forged-step", title: "Untrusted event" },
          },
        },
      ],
    },
  });
});
afterAll(async () => {
  await database?.cleanup();
});

test("FR-K1 and FR-D9 read the real persisted case, steps, events and sourced checklist", async () => {
  const snapshot = await createWorkspaceService(database.db, owner).snapshot({
    caseId,
    benefitId: benefit.id,
  });
  expect(snapshot.cases.map((entry) => entry.id)).toEqual([caseId]);
  expect(snapshot.steps[0]).toMatchObject({ id: stepId, status: "completed", owner: "pilot" });
  expect(snapshot.steps).toHaveLength(1);
  expect(snapshot.checklist.some((entry) => entry.status === "have")).toBe(true);
  expect(snapshot.checklist.every((entry) => entry.source.url.startsWith("https://"))).toBe(true);
  expect(snapshot.facilities[0]?.phone).toBe(facility.phone);
  const draft = prepareWorkspaceAppointment(snapshot, { caseId, facilityId: facility.id });
  expect(draft.email).toBe(facility.email);
});

test("the workspace denies another user's case and never returns their documents", async () => {
  const service = createWorkspaceService(database.db, outsider);
  await expect(service.snapshot({ caseId })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  const snapshot = await service.snapshot({});
  expect(snapshot.cases).toEqual([]);
  expect(snapshot.currentCase).toBeNull();
  expect(snapshot.documents).toEqual([]);
  expect(snapshot.steps).toEqual([]);
});

test("the document checklist selects a catalog benefit through the persisted process steps", async () => {
  const snapshot = await createWorkspaceService(database.db, owner).snapshot({ caseId });
  expect(snapshot.selectedBenefitId).toBe(benefit.id);
  expect(snapshot.checklist.length).toBeGreaterThan(0);
  await expect(
    createWorkspaceService(database.db, owner).snapshot({
      caseId,
      benefitId: "unknown-test-benefit",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("FR-D5 prepared forms link only from the authorized case workspace", async () => {
  const templateId = randomUUID();
  const instanceId = randomUUID();
  await database.db.insert(formTemplates).values({
    id: templateId,
    publisher: "Test",
    title: "Administrative form",
    source: "https://example.org/form.pdf",
    hash: "0".repeat(64),
    format: "flat",
    pages: 1,
    schema: { fields: [] },
    storageKey: "test-form.pdf",
  });
  await database.db
    .insert(formInstances)
    .values({ id: instanceId, caseId, subjectId, templateId, fields: {} });
  const snapshot = await createWorkspaceService(database.db, owner).snapshot({ caseId });
  expect(snapshot.forms).toEqual([{ id: instanceId, title: "Administrative form" }]);
  const other = await createWorkspaceService(database.db, outsider).snapshot({});
  expect(other.forms).toEqual([]);
});
