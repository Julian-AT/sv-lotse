import type { FormField } from "../schema.ts";

/** Enrich catalog mappings without duplicating widgets or dropping undetected fields. */
export function reconcileFormFields(current: FormField[], detected: FormField[]): FormField[] {
  const matches = (left: FormField, right: FormField): boolean =>
    left.id === right.id || (left.acro_field !== undefined && left.acro_field === right.acro_field);
  const enriched = current.map((field) => {
    const widgets = detected.filter((candidate) => matches(field, candidate));
    const location = widgets.find((candidate) => candidate.page === field.page) ?? widgets[0];
    const restricted = widgets.find((candidate) => candidate.owner !== "applicant");
    return {
      ...field,
      ...(location ? { page: location.page, box: location.box } : {}),
      owner: field.owner === "applicant" ? (restricted?.owner ?? field.owner) : field.owner,
      signature: widgets.some((candidate) => candidate.signature === "subject")
        ? ("subject" as const)
        : field.signature,
    };
  });
  return [
    ...enriched,
    ...detected.filter((field) => !current.some((candidate) => matches(field, candidate))),
  ];
}
