import type { DatabaseClient } from "@lotse/db";
import {
  benefits,
  caseActors,
  caseSteps,
  cases,
  documents,
  facilities,
  formInstances,
  formTemplates,
  messages,
  processes,
  subjects,
} from "@lotse/db/schema";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { effectiveShareScope } from "../subjects/access.ts";
import { helperSessionAccess } from "../subjects/session-access.ts";
import { createConversationWorkspaceService } from "./conversation.ts";
import { projectChecklist, projectJourney, readWorkspaceEvents } from "./projection.ts";
import { checklistBenefitRecord, directoryRecord, workspaceProcessRecord } from "./records.ts";
import {
  type WorkspaceCase,
  WorkspaceError,
  type WorkspaceFacility,
  type WorkspaceSnapshot,
  workspaceQuerySchema,
  workspaceSnapshotSchema,
} from "./schema.ts";

export interface WorkspaceService extends ReturnType<typeof createConversationWorkspaceService> {
  snapshot(query: z.infer<typeof workspaceQuerySchema>): Promise<WorkspaceSnapshot>;
}

async function ownedCases(
  db: DatabaseClient,
  userId: string,
  sessionId?: string,
): Promise<WorkspaceCase[]> {
  const rows = await db
    .select({
      id: cases.id,
      role: caseActors.role,
      scope: caseActors.shareScope,
      createdBy: subjects.createdBy,
      subjectId: cases.subjectId,
      subjectName: subjects.displayName,
      title: cases.confirmedGoal,
      status: cases.status,
      createdAt: cases.createdAt,
    })
    .from(cases)
    .innerJoin(subjects, eq(subjects.id, cases.subjectId))
    .leftJoin(caseActors, and(eq(caseActors.caseId, cases.id), eq(caseActors.userId, userId)))
    .where(
      or(
        eq(subjects.createdBy, userId),
        eq(caseActors.role, "subject"),
        and(
          eq(caseActors.role, "helper"),
          helperSessionAccess(sql`${cases.id}`, userId, sessionId),
        ),
      ),
    )
    .orderBy(desc(cases.createdAt));
  return rows
    .filter(
      (row) =>
        row.createdBy === userId || row.role === "subject" || effectiveShareScope(row.scope).case,
    )
    .map(({ role: _role, scope: _scope, createdBy: _createdBy, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
}

function projectFacility(record: z.infer<typeof directoryRecord>): WorkspaceFacility {
  const address = record.address;
  const hours = record.opening_hours;
  return {
    id: record.id,
    title: record.name_de,
    type: record.type,
    region: record.region ?? null,
    address: address ? `${address.street}, ${address.postal_code} ${address.locality}` : "",
    location: record.location ?? null,
    openingHours:
      typeof hours === "string"
        ? hours
        : hours
          ? Object.entries(hours)
              .map(([day, value]) => `${day}: ${value}`)
              .join(" · ")
          : null,
    phone: record.phone ?? null,
    email: record.email ?? null,
    url: record.url ?? null,
    bookingUrls: record.appointment_channels ?? [],
    accessibility: record.accessibility ?? null,
    services: record.services ?? [],
    sources: record.sources,
    asOf: record.as_of,
    distanceKm: null,
  };
}

/** Helper journeys omit owner conversation events and unshared documents.
 * Bind userId exclusively from requireSession; never from a URL or request body.
 */
export function createWorkspaceService(
  db: DatabaseClient,
  userId: string,
  sessionId?: string,
): WorkspaceService {
  z.uuid().parse(userId);
  return {
    ...createConversationWorkspaceService(db, userId, sessionId),
    async snapshot(rawQuery) {
      const parsed = workspaceQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new WorkspaceError("INVALID_INPUT");
      const query = parsed.data;
      const availableCases = await ownedCases(db, userId, sessionId);
      const currentCase = query.caseId
        ? availableCases.find((entry) => entry.id === query.caseId)
        : availableCases[0];
      if (query.caseId && !currentCase) throw new WorkspaceError("ACCESS_DENIED");
      const [benefitRows, facilityRows, processRows] = await Promise.all([
        db.select().from(benefits).orderBy(asc(benefits.title)),
        db.select().from(facilities).orderBy(asc(facilities.title)),
        db.select().from(processes),
      ]);
      const benefitRecords = benefitRows.map((row) => checklistBenefitRecord.parse(row.record));
      const directory = facilityRows.map((row) =>
        projectFacility(directoryRecord.parse(row.record)),
      );
      const snapshot: WorkspaceSnapshot = {
        cases: availableCases,
        currentCase: currentCase ?? null,
        steps: [],
        events: [],
        documents: [],
        forms: [],
        benefits: benefitRecords.map((record) => ({ id: record.id, title: record.name_de })),
        selectedBenefitId: null,
        checklist: [],
        facilities: directory,
      };
      if (!currentCase) return workspaceSnapshotSchema.parse(snapshot);
      const [grant] = await db
        .select({
          role: caseActors.role,
          scope: caseActors.shareScope,
          createdBy: subjects.createdBy,
        })
        .from(cases)
        .innerJoin(subjects, eq(subjects.id, cases.subjectId))
        .leftJoin(caseActors, and(eq(caseActors.caseId, cases.id), eq(caseActors.userId, userId)))
        .where(
          and(
            eq(cases.id, currentCase.id),
            or(
              eq(subjects.createdBy, userId),
              eq(caseActors.role, "subject"),
              and(
                eq(caseActors.role, "helper"),
                helperSessionAccess(currentCase.id, userId, sessionId),
              ),
            ),
          ),
        );
      if (!grant) throw new WorkspaceError("ACCESS_DENIED");
      const helper = grant.role !== "subject" && grant.createdBy !== userId;
      const scope = effectiveShareScope(grant.scope);
      if (helper && !scope.case) throw new WorkspaceError("ACCESS_DENIED");
      const [storedSteps, storedDocuments, storedMessages, storedForms] = await Promise.all([
        db
          .select()
          .from(caseSteps)
          .where(eq(caseSteps.caseId, currentCase.id))
          .orderBy(asc(caseSteps.createdAt), asc(caseSteps.id)),
        db
          .select({
            id: documents.id,
            type: documents.type,
            ocrStatus: documents.ocrStatus,
            createdAt: documents.createdAt,
          })
          .from(documents)
          .where(
            and(
              eq(documents.subjectId, currentCase.subjectId),
              helper && scope.documents !== true
                ? Array.isArray(scope.documents) && scope.documents.length
                  ? inArray(documents.id, scope.documents)
                  : sql`false`
                : undefined,
            ),
          )
          .orderBy(desc(documents.createdAt)),
        helper
          ? Promise.resolve([])
          : db
              .select({ message: messages.uiMessage })
              .from(messages)
              .where(and(eq(messages.caseId, currentCase.id)))
              .orderBy(asc(messages.position)),
        db
          .select({ id: formInstances.id, title: formTemplates.title })
          .from(formInstances)
          .innerJoin(formTemplates, eq(formTemplates.id, formInstances.templateId))
          .where(
            and(
              eq(formInstances.caseId, currentCase.id),
              eq(formInstances.subjectId, currentCase.subjectId),
            ),
          )
          .orderBy(desc(formInstances.createdAt)),
      ]);
      snapshot.forms = storedForms;
      const eventList = readWorkspaceEvents(
        storedMessages
          .filter((row) => row.message.role === "assistant")
          .flatMap((row) => row.message.parts),
        currentCase.id,
      );
      const definitions = processRows.map((row) => workspaceProcessRecord.parse(row.record));
      const matchingProcesses = definitions.filter((record) =>
        record.steps.some((step) =>
          storedSteps.some(
            (stored) =>
              stored.processStep === step.id || stored.processStep === `${record.id}/${step.id}`,
          ),
        ),
      );
      const relatedProcess = matchingProcesses.length === 1 ? matchingProcesses[0] : undefined;
      const titles = new Map(
        relatedProcess?.steps.flatMap((step) =>
          step.action
            ? [
                [step.id, step.action] as const,
                [`${relatedProcess?.id}/${step.id}`, step.action] as const,
              ]
            : [],
        ) ?? [],
      );
      const derivedBenefit = relatedProcess?.benefit.replace(/^ref:catalog\//, "");
      const selectedBenefitId = query.benefitId ?? derivedBenefit ?? null;
      const selectedBenefit = benefitRecords.find((record) => record.id === selectedBenefitId);
      if (query.benefitId && !selectedBenefit) throw new WorkspaceError("NOT_FOUND");
      snapshot.steps = projectJourney(storedSteps, eventList, titles);
      snapshot.events = eventList.map((event, position) => ({
        id: `${currentCase.id}:${position}`,
        kind: event.kind,
        stepId: typeof event.payload.stepId === "string" ? event.payload.stepId : null,
      }));
      snapshot.documents = storedDocuments.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }));
      snapshot.selectedBenefitId = selectedBenefit?.id ?? null;
      snapshot.checklist = selectedBenefit
        ? projectChecklist(
            selectedBenefit.documents,
            storedDocuments.map((document) => document.type),
          )
        : [];
      return workspaceSnapshotSchema.parse(snapshot);
    },
  };
}
