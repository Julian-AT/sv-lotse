"use client";
import type { ShareScope } from "@lotse/brain/subjects";
import type { ReactElement } from "react";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import type { RelativesCopy } from "./copy.ts";
import styles from "./relatives.module.css";

export type ScopeChoice = "none" | "case" | "selected";
export function inviteScope(choice: ScopeChoice, factIds: string[] = []): ShareScope {
  return {
    mode: "restricted",
    case: choice !== "none",
    factTypes: [],
    ...(choice === "selected" ? { factIds } : {}),
  };
}
const factsSchema = z.object({
  facts: z.array(z.object({ id: z.uuid(), type: z.string(), value: z.unknown() })),
});

export function ScopePicker({
  caseId,
  subjectId,
  value,
  onChange,
  disabled,
  copy,
}: {
  caseId: string;
  subjectId: string;
  value: ShareScope;
  onChange: (scope: ShareScope) => void;
  disabled: boolean;
  copy: RelativesCopy;
}): ReactElement {
  const id = useId();
  const [choice, setChoice] = useState<ScopeChoice>("none");
  const [facts, setFacts] = useState<z.infer<typeof factsSchema>["facts"]>([]);
  const [failed, setFailed] = useState(false);
  const selected = value.mode === "restricted" ? (value.factIds ?? []) : [];
  useEffect(() => {
    if (choice !== "selected") return;
    const controller = new AbortController();
    setFailed(false);
    void fetch(
      `/api/facts?subjectId=${encodeURIComponent(subjectId)}&caseId=${encodeURIComponent(caseId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("FACTS_UNAVAILABLE");
        const result = factsSchema.parse(await response.json());
        if (!controller.signal.aborted) setFacts(result.facts);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [caseId, subjectId, choice]);
  return (
    <fieldset className={styles.scopePicker} disabled={disabled}>
      <legend>{copy.scopeLabel}</legend>
      <select
        aria-label={copy.scopeLabel}
        value={choice}
        onChange={(event) => {
          const next = z.enum(["none", "case", "selected"]).parse(event.target.value);
          setChoice(next);
          onChange(inviteScope(next));
        }}
      >
        <option value="none">{copy.scopeScreen}</option>
        <option value="case">{copy.scopeCase}</option>
        <option value="selected">{copy.scopeSelected}</option>
      </select>
      {choice === "selected" && (
        <>
          <p>{copy.selectFacts}</p>
          {facts.map((fact) => (
            <label key={fact.id} htmlFor={`${id}-${fact.id}`}>
              <input
                id={`${id}-${fact.id}`}
                type="checkbox"
                checked={selected.includes(fact.id)}
                onChange={(event) => {
                  onChange(
                    inviteScope(
                      "selected",
                      event.target.checked
                        ? [...selected, fact.id]
                        : selected.filter((entry) => entry !== fact.id),
                    ),
                  );
                }}
              />
              {typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}
            </label>
          ))}
          {facts.length === 0 && <p>{copy.noFacts}</p>}
          {failed && <p role="alert">{copy.error}</p>}
        </>
      )}
    </fieldset>
  );
}
