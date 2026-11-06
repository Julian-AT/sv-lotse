import type { Provenance } from "@lotse/protocol";
import type { Citation } from "@lotse/ui";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";

/** Internal links keep document/statement provenance within the authorized workspace. */
export function fieldCitation(
  fieldId: string,
  provenance: Provenance | undefined,
  language: FormViewerLanguage,
): Citation {
  const copy = formViewerCopy[language];
  const source = provenance?.source;
  const title =
    source?.kind === "document"
      ? `${copy.document}${source.page ? ` · ${copy.page} ${source.page}` : ""}`
      : source
        ? copy.statement
        : copy.noSource;
  return {
    id: provenance?.factId ?? fieldId,
    title,
    quote: source?.quote ?? "",
    asOf: "",
    url: `#${encodeURIComponent(`form-source-${fieldId}`)}`,
  };
}
