"use client";

import { de } from "@lotse/ui";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { type JSX, type ReactNode, useId, useState } from "react";
import { SourceChip } from "@/components/gen-ui/source-chips.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "../i18n/provider.tsx";
import { changeFact } from "./api.ts";
import { workspaceLabels } from "./copy.ts";
import { DocumentEvidence } from "./document-evidence.tsx";
import type { ReviewableFact } from "./schemas.ts";
import { factCitation } from "./sources.ts";

/** One proposed or confirmed fact. Nothing is saved before the user confirms, edits or rejects. */
export function ReviewFact({
  fact,
  onSaved,
}: {
  fact: ReviewableFact;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const labels = { ...de, ...workspaceLabels(i18n) };
  const heading = useId();
  const input = useId();
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
  const source = factCitation(
    fact.id,
    fact.source,
    t(fact.source.kind === "document" ? "workspace.sourceDocument" : "workspace.sourceStatement"),
    { subjectId: fact.subjectId },
  );
  return (
    <div id={`fact-${fact.id}`} className="grid gap-2">
      <section aria-labelledby={heading} aria-busy={pending || undefined} className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id={heading} className="m-0 text-xs font-medium text-muted-foreground">
            {fact.type}
          </h4>
          <Badge variant={fact.confirmed ? "secondary" : "outline"}>
            {fact.confirmed ? labels.confirmed : labels.draft}
          </Badge>
        </div>
        <p className="m-0 text-[0.875rem] font-medium leading-snug">{factValue}</p>
        {source.quote && (
          <blockquote className="m-0 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
            {source.quote}
          </blockquote>
        )}
        <SourceChip source={source} labels={labels} className="w-fit" />
        <div className="flex flex-wrap gap-1.5">
          {!fact.confirmed && (
            <Button size="sm" disabled={pending} onClick={() => void mutate("confirm")}>
              <CheckIcon aria-hidden="true" />
              {labels.confirm}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
            <PencilIcon aria-hidden="true" />
            {labels.edit}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void mutate("reject")}
          >
            <XIcon aria-hidden="true" />
            {labels.reject}
          </Button>
        </div>
      </section>
      <DocumentEvidence
        source={fact.source}
        subjectId={fact.subjectId}
        language={i18n.locale === "en" ? "en" : "de"}
      />
      {editing && (
        <form
          className="grid gap-2 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("edit");
          }}
        >
          <Label htmlFor={input} className="text-xs">
            {t("workspace.editValue")}
          </Label>
          <Input
            id={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={pending}
          />
          <div className="flex gap-1.5">
            <Button size="sm" type="submit" disabled={pending}>
              {t("workspace.save")}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              {t("workspace.cancel")}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {t("workspace.error")}
        </p>
      )}
    </div>
  );
}

/** Inline review card in the conversation (replaces the former side panel). */
export function FactsReview({
  facts,
  error,
  retrying,
  onRetry,
  onSaved,
}: {
  facts: readonly ReviewableFact[];
  error: boolean;
  retrying: boolean;
  onRetry: () => void;
  onSaved: (fact: ReviewableFact) => Promise<void>;
}): JSX.Element | null {
  const { t } = useI18n();
  const heading = useId();
  // Confirmed facts belong to the person, not the chat; only new proposals need a review here.
  const pending = facts.filter((fact) => !fact.confirmed);
  if (!error && pending.length === 0) return null;
  const open = pending.length;
  const rows: ReactNode[] = pending.map((fact, index) => (
    <div key={fact.id} className="grid gap-3">
      {index > 0 && <Separator />}
      <ReviewFact fact={fact} onSaved={() => onSaved(fact)} />
    </div>
  ));
  return (
    <section aria-labelledby={heading} className="w-[min(100%,560px)] pl-10">
      <Card className="fade-up gap-3">
        <CardHeader>
          <CardTitle id={heading} role="heading" aria-level={2}>
            {t("workspace.facts")}
          </CardTitle>
          {open > 0 && <CardDescription>{t("workspace.factsHint")}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{t("workspace.error")}</span>
                <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
                  {t("workspace.retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {rows}
        </CardContent>
      </Card>
    </section>
  );
}
