import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  projectChecklist,
  projectJourney,
  readWorkspaceEvents,
  type StoredWorkspaceStep,
} from "../../src/workspace/projection.ts";

const caseId = randomUUID();
const source = {
  url: "https://www.fsw.at/standorte",
  quote: "Guglgasse 7–9",
  retrieved_at: "2026-11-06T01:35:29Z",
};

test("FR-D9 matches document types exactly and preserves where to obtain and source", () => {
  // Constructed requirements exercise missing/optional cases absent from the source catalog.
  const requirement = {
    id: "test-required",
    name_de: "Testunterlage",
    required: true,
    obtain_from: "Ausstellende Stelle",
    source,
  };
  const result = projectChecklist(
    [
      requirement,
      { ...requirement, id: "test-missing", obtain_from: "" },
      { ...requirement, id: "test-optional", required: false },
    ],
    [],
  );
  expect(result.map((entry) => entry.status)).toEqual(["obtainable", "missing"]);
  expect(result[0]).toMatchObject({ where: requirement.obtain_from, source });
  expect(projectChecklist([requirement], [requirement.id])[0]?.status).toBe("have");
  expect(projectChecklist([requirement], [requirement.name_de])[0]?.status).toBe("have");
  expect(projectChecklist([requirement], ["Testunterlage ähnlich"])[0]?.status).toBe("obtainable");
});

test("FR-K1 projects live case-step status, responsibility, prepared artefacts and due dates", () => {
  const base: StoredWorkspaceStep = {
    id: "test-step",
    processStep: "test-process-step",
    status: "in_progress",
    owner: "office",
    dueAt: new Date("2026-11-07T08:00:00Z"),
    linkedArtifacts: [],
  };
  expect(
    projectJourney([base], [], new Map([[base.processStep, "Zuständigkeit klären"]]))[0],
  ).toEqual({
    id: base.id,
    title: "Zuständigkeit klären",
    status: "current",
    owner: "office",
    dueDate: "2026-11-07T08:00:00.000Z",
    blocked: false,
  });
  expect(
    projectJourney(
      [{ ...base, status: "pending", owner: "pilot", linkedArtifacts: ["prepared-document"] }],
      [],
    )[0]?.status,
  ).toBe("prepared");
  expect(projectJourney([{ ...base, status: "blocked" }], [])[0]?.blocked).toBe(true);
});

test("FR-K1 applies persisted events without reviving a completed step", () => {
  const events = readWorkspaceEvents(
    [
      {
        type: "data-case-event",
        data: {
          caseId,
          kind: "step_created",
          payload: { stepId: "test-event-step", title: "Anruf vorbereiten", owner: "pilot" },
        },
      },
      {
        type: "data-case-event",
        data: { caseId, kind: "step_completed", payload: { stepId: "test-event-step" } },
      },
      {
        type: "data-case-event",
        data: { caseId, kind: "artefact_ready", payload: { stepId: "test-event-step" } },
      },
      {
        type: "data-case-event",
        data: { caseId: randomUUID(), kind: "step_created", payload: { stepId: "foreign-step" } },
      },
      { type: "text", text: "Untrusted content" },
    ],
    caseId,
  );
  expect(events).toHaveLength(3);
  expect(projectJourney([], events)).toEqual([
    {
      id: "test-event-step",
      title: "Anruf vorbereiten",
      status: "completed",
      owner: "pilot",
      blocked: false,
    },
  ]);
});

test("FR-K1 only accepts completed server tool results as case events", () => {
  const output = [{ caseId, kind: "goal_confirmed", payload: { goal: "Unterlagen" } }];
  expect(
    readWorkspaceEvents(
      [
        { type: "tool-case.update", state: "output-available", output },
        { type: "tool-case.update", state: "input-available", output },
      ],
      caseId,
    ),
  ).toHaveLength(1);
});

test("FR-K5 shows pilot initiation independently of the user responsible for the next step", () => {
  const step: StoredWorkspaceStep = {
    id: "test-next",
    processStep: "test-flow/follow-up",
    status: "pending",
    owner: "user",
    initiatedBy: "pilot",
    dueAt: null,
    linkedArtifacts: [
      {
        id: "test-draft",
        type: "document_request",
        text: "Administrative draft",
        sources: [source],
      },
    ],
  };
  expect(projectJourney([step], [])[0]).toMatchObject({
    owner: "user",
    initiatedBy: "pilot",
    status: "prepared",
    artifacts: [{ id: "test-draft", text: "Administrative draft", sources: [source] }],
  });
});
