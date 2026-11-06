"use client";

import { Button, FactCard, Field, Inline, TextInput } from "@lotse/ui";
import { type JSX, useState } from "react";
import { useI18n } from "../i18n/provider.tsx";
import { changeFact } from "./api.ts";
import { workspaceLabels } from "./copy.ts";
import { DocumentEvidence } from "./document-evidence.tsx";
import type { ReviewableFact } from "./schemas.ts";
import { factCitation } from "./sources.ts";

export function ReviewFact({
  fact,
  onSaved,
}: {
  fact: ReviewableFact;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const [editing, setEditing] = useState(false);
  const factValue = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
  const [value, setValue] = useState(factValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const mutate = async (action: "confirm" | "reject" | "edit"): Promise<void> => {
    setPending(true);
    setError(false);
    try {
      await changeFact(fact, action, action === "edit" ? value : undefined);
      setEditing(false);
      await onSaved();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div id={`fact-${fact.id}`}>
      <FactCard
        label={fact.type}
        value={factValue}
        source={factCitation(
          fact.id,
          fact.source,
          t(
            fact.source.kind === "document"
              ? "workspace.sourceDocument"
              : "workspace.sourceStatement",
          ),
          { subjectId: fact.subjectId },
        )}
        labels={workspaceLabels(i18n)}
        state={fact.confirmed ? "confirmed" : "draft"}
        pending={pending}
        onConfirm={() => void mutate("confirm")}
        onReject={() => void mutate("reject")}
        onEdit={() => setEditing(true)}
      />
      <DocumentEvidence
        source={fact.source}
        subjectId={fact.subjectId}
        language={i18n.locale === "en" ? "en" : "de"}
      />
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("edit");
          }}
        >
          <Field label={t("workspace.editValue")}>
            <TextInput
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={pending}
            />
          </Field>
          <Inline>
            <Button type="submit" disabled={pending}>
              {t("workspace.save")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
              {t("workspace.cancel")}
            </Button>
          </Inline>
        </form>
      )}
      {error && <p role="alert">{t("workspace.error")}</p>}
    </div>
  );
}
