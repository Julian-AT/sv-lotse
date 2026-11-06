"use client";

import {
  type FieldCorrection,
  isEditableField,
  isValidFieldValue,
  type ViewerField,
  type ViewerInstance,
  type ViewerValue,
} from "@lotse/brain/forms/viewer/schema";
import type { TypePayload } from "@lotse/protocol";
import { CheckIcon, FileTextIcon, MessageSquareQuoteIcon } from "lucide-react";
import { Fragment, type JSX, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formFieldElementId } from "../../conversation/open-resource.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import { fieldCitation } from "./provenance.ts";

const LONG_TEXT_LENGTH = 100;

interface Section {
  key: string;
  title: string;
  readOnly: boolean;
  order: number;
  fields: ViewerField[];
}

function sectionsOf(fields: ViewerField[], language: FormViewerLanguage): Section[] {
  const copy = formViewerCopy[language];
  const sections = new Map<string, Section>();
  for (const field of fields) {
    const readOnly = !isEditableField(field);
    const page = field.box?.page;
    const key = readOnly ? `reserved-${field.owner}` : `page-${page ?? "other"}`;
    const section = sections.get(key) ?? {
      key,
      readOnly,
      title: readOnly ? copy.reservedBy[field.owner] : page ? `${copy.page} ${page}` : copy.other,
      order: readOnly ? 10_000 : (page ?? 9_999),
      fields: [],
    };
    section.fields.push(field);
    sections.set(key, section);
  }
  return [...sections.values()].sort((a, b) => a.order - b.order);
}

function isEmpty(value: ViewerValue["value"] | undefined): boolean {
  return value === undefined || value === null || value === "" || value === false;
}

/** Every field with a value counts, including sourced entries in a professional's part. */
export function filledFieldCount(instance: ViewerInstance): number {
  return instance.schema.fields.filter((field) => !isEmpty(instance.fields[field.id]?.value))
    .length;
}

/** Fields that take a value at all: everything except signatures. */
export function fillableFieldCount(instance: ViewerInstance): number {
  const fillable = instance.schema.fields.filter(
    (field) => field.type !== "signature" && field.signature === "none",
  ).length;
  return Math.max(fillable, filledFieldCount(instance));
}

interface FieldProps {
  field: ViewerField;
  value: ViewerValue | undefined;
  preview: TypePayload | undefined;
  active: boolean;
  language: FormViewerLanguage;
  elements: Map<string, HTMLElement>;
  onEdit: (fieldId: string | null) => void;
  onSave: (input: FieldCorrection) => Promise<void>;
}

function SourceChip({
  field,
  value,
  preview,
  language,
}: Pick<FieldProps, "field" | "value" | "preview" | "language">): JSX.Element | null {
  const provenance = preview?.provenance ?? value?.provenance;
  if (!provenance) return null;
  const source = fieldCitation(field.id, provenance, language);
  const confirmed = !preview && value?.state === "confirmed";
  const Icon = confirmed
    ? CheckIcon
    : provenance.source.kind === "document"
      ? FileTextIcon
      : MessageSquareQuoteIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          tabIndex={0}
          className="h-4 cursor-default px-1.5 text-[0.6875rem] font-normal text-muted-foreground"
        >
          <Icon aria-hidden="true" />
          {confirmed ? formViewerCopy[language].confirmed : source.title}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">{source.title}</p>
        {source.quote && <p className="opacity-80">„{source.quote}“</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function FormField(props: FieldProps): JSX.Element {
  const { field, value, preview, language } = props;
  const copy = formViewerCopy[language];
  const editable = isEditableField(field);
  const label = field.labels[language] ?? field.label_de;
  const inputId = `form-edit-${field.id}`;
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const stored = value?.value ?? "";
  const shown = draft ?? preview?.value ?? (typeof stored === "boolean" ? "" : String(stored));
  const empty = !preview && isEmpty(value?.value);
  // A professional's part filled from the person's documents stays read-only but fully legible.
  const reservedFilled = !editable && !empty;
  const legible = reservedFilled && "disabled:cursor-default disabled:opacity-100";
  const missing = editable && field.validation.required === true && empty;
  const invalid = editable && !empty && !preview && !isValidFieldValue(field, stored);

  const save = async (next: FieldCorrection["value"]): Promise<void> => {
    if (next === stored) {
      setDraft(null);
      props.onEdit(null);
      return;
    }
    setPending(true);
    setError(false);
    try {
      await props.onSave({ fieldId: field.id, value: next });
      setDraft(null);
      props.onEdit(null);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  const change = (next: string): void => {
    props.onEdit(field.id);
    setDraft(next);
  };
  const commitDraft = (): void => {
    if (draft === null) return;
    void save(field.type === "number" && draft !== "" ? Number(draft) : draft);
  };
  const textProps = {
    id: inputId,
    value: shown,
    disabled: !editable || pending,
    "aria-invalid": error || invalid || undefined,
    maxLength: field.validation.max_length,
    onBlur: commitDraft,
  };
  const placeholder = !editable ? copy.readOnly : field.type === "date" ? "JJJJ-MM-TT" : undefined;
  const long = (field.validation.max_length ?? 0) > LONG_TEXT_LENGTH;

  const control =
    field.type === "checkbox" ? (
      <Checkbox
        id={inputId}
        disabled={!editable || pending}
        checked={preview ? preview.value === "true" : stored === true}
        aria-invalid={error || undefined}
        className={cn(legible)}
        onCheckedChange={(checked) => {
          props.onEdit(field.id);
          void save(checked === true);
        }}
      />
    ) : field.validation.options ? (
      <Select
        value={shown || undefined}
        disabled={!editable || pending}
        onValueChange={(next) => {
          props.onEdit(field.id);
          void save(next);
        }}
      >
        <SelectTrigger
          id={inputId}
          size="sm"
          className={cn("h-7! min-h-0 w-full text-[0.8125rem]", legible)}
          aria-invalid={error || undefined}
        >
          <SelectValue placeholder={editable ? "—" : copy.readOnly} />
        </SelectTrigger>
        <SelectContent>
          {field.validation.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : long ? (
      <Textarea
        {...textProps}
        placeholder={placeholder}
        rows={2}
        className={cn("min-h-12 px-2.5 py-1.5 text-[0.8125rem] md:text-[0.8125rem]", legible)}
        onChange={(event) => change(event.target.value)}
      />
    ) : (
      <Input
        {...textProps}
        placeholder={placeholder}
        inputMode={field.type === "number" ? "decimal" : undefined}
        className={cn("h-7 min-h-0 px-2.5 text-[0.8125rem] md:text-[0.8125rem]", legible)}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    );

  const hint = error ? (
    <span role="alert" className="text-destructive">
      {copy.saveError}
    </span>
  ) : missing ? (
    <span className="text-amber-700 dark:text-amber-400">{copy.missingShort}</span>
  ) : invalid ? (
    <span className="text-destructive">{copy.invalidShort}</span>
  ) : null;
  const meta = (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs">
      {hint}
      {reservedFilled && (
        <Badge variant="secondary" className="h-4 px-1.5 text-[0.6875rem] font-normal">
          {copy.ownerBadge[field.owner]}
        </Badge>
      )}
      <SourceChip field={field} value={value} preview={preview} language={language} />
    </span>
  );

  return (
    <div
      id={formFieldElementId(field.id)}
      data-active={props.active || undefined}
      ref={(element) => {
        if (element) props.elements.set(field.id, element);
        else props.elements.delete(field.id);
      }}
      className={cn(
        "min-w-0 scroll-my-16 rounded-lg px-1.5 py-1 transition-[background-color,box-shadow] duration-200",
        "data-active:bg-primary/5 data-active:ring-2 data-active:ring-primary/50",
        "data-pointed:bg-primary/5 data-pointed:ring-2 data-pointed:ring-primary/60",
        field.type === "checkbox" ? "sm:col-span-2" : "flex flex-col gap-1",
        !editable && empty && "opacity-70",
        long && "sm:col-span-2",
      )}
    >
      {field.type === "checkbox" ? (
        <div className="flex items-start gap-2">
          <div className="pt-px">{control}</div>
          <Label
            htmlFor={inputId}
            className="min-w-0 text-xs leading-snug font-normal"
            title={label}
          >
            <span className="[overflow-wrap:anywhere]">{label}</span>
          </Label>
          {meta}
        </div>
      ) : (
        <>
          <div className="flex min-h-4 flex-wrap items-start gap-1.5">
            <Label
              htmlFor={inputId}
              className="min-w-0 flex-[1_1_8rem] text-xs leading-snug"
              title={label}
            >
              <span className="[overflow-wrap:anywhere]">{label}</span>
            </Label>
            {meta}
          </div>
          {control}
        </>
      )}
    </div>
  );
}

export function FormFieldList(props: {
  instance: ViewerInstance;
  language: FormViewerLanguage;
  preview: Record<string, TypePayload>;
  activeField: string | null;
  elements: Map<string, HTMLElement>;
  onEdit: (fieldId: string | null) => void;
  onSave: (input: FieldCorrection) => Promise<void>;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {sectionsOf(props.instance.schema.fields, props.language).map((section, index) => (
        <Fragment key={section.key}>
          {index > 0 && <Separator />}
          <section aria-label={section.title} className="flex flex-col gap-2">
            <h3 className="m-0 px-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {section.title}
            </h3>
            <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
              {section.fields.map((field) => (
                <FormField
                  key={field.id}
                  field={field}
                  value={props.instance.fields[field.id]}
                  preview={props.preview[field.id]}
                  active={props.activeField === field.id}
                  language={props.language}
                  elements={props.elements}
                  onEdit={props.onEdit}
                  onSave={props.onSave}
                />
              ))}
            </div>
          </section>
        </Fragment>
      ))}
    </div>
  );
}
