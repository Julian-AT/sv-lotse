"use client";
import { workspaceSnapshotSchema } from "@lotse/brain/workspace/schema";
import { en, JourneyMap } from "@lotse/ui";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { relativeRequest } from "./api.ts";
import { RELATIVE_POLL_MS } from "./config.ts";
import type { RelativesCopy } from "./copy.ts";
import { relativesCopy } from "./copy.ts";

const sharedJourneySchema = z.object({
  title: z.string(),
  steps: workspaceSnapshotSchema.shape.steps,
  facts: z.array(z.object({ id: z.uuid(), type: z.string(), value: z.unknown() })),
});
export function RelativeJourney({
  caseId,
  copy,
}: {
  caseId: string;
  copy: RelativesCopy;
}): ReactElement | null {
  const [journey, setJourney] = useState<z.infer<typeof sharedJourneySchema> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load(): Promise<void> {
      try {
        const snapshot = await relativeRequest(
          `/api/workspace?caseId=${encodeURIComponent(caseId)}`,
          workspaceSnapshotSchema,
          undefined,
          controller.signal,
        );
        if (!snapshot.currentCase) throw new Error("CASE_UNAVAILABLE");
        const facts = await relativeRequest(
          `/api/facts?caseId=${encodeURIComponent(caseId)}&subjectId=${encodeURIComponent(snapshot.currentCase.subjectId)}`,
          z.object({ facts: sharedJourneySchema.shape.facts }),
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setJourney({
            title: snapshot.currentCase.title,
            steps: snapshot.steps,
            facts: facts.facts,
          });
      } catch {
        if (!controller.signal.aborted) setJourney(null);
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), RELATIVE_POLL_MS);
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [caseId]);
  if (!journey) return null;
  return (
    <section>
      <h2>{journey.title}</h2>
      <JourneyMap
        steps={journey.steps.map(({ dueDate, ...step }) => ({
          ...step,
          ...(dueDate ? { dueDate } : {}),
        }))}
        labels={copy.title === relativesCopy.en.title ? en : {}}
      />
      {journey.facts.length > 0 && (
        <>
          <h3>{copy.sharedFacts}</h3>
          <ul>
            {journey.facts.map((fact) => (
              <li key={fact.id}>
                {typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
