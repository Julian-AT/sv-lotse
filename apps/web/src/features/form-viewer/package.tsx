"use client";

import { DownloadIcon, FileDownIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formExportUrl, formPackageUrl } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";

const PackageContent = z.object({
  attachmentChecklist: z.array(z.string()),
  coverLetter: z.string(),
  pdfUrl: z.string(),
});

export function FormPackage(props: {
  formInstanceId: string;
  language: FormViewerLanguage;
  blocked: boolean;
  children?: ReactNode;
}): JSX.Element {
  const copy = formViewerCopy[props.language];
  const [result, setResult] = useState<z.infer<typeof PackageContent>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const create = async (): Promise<void> => {
    setPending(true);
    setError(false);
    setResult(undefined);
    try {
      const response = await fetch(formPackageUrl(props.formInstanceId), {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("FORM_PACKAGE_FAILED");
      const content = PackageContent.parse(await response.json());
      if (content.pdfUrl !== formExportUrl(props.formInstanceId))
        throw new Error("FORM_PACKAGE_FAILED");
      setResult(content);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="flex flex-col gap-3 border-t border-border px-5 py-3"
      aria-label={copy.packageTitle}
      aria-busy={pending}
    >
      {error && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {copy.packageError}
        </p>
      )}
      {result && (
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <h3 className="m-0 text-xs font-medium text-muted-foreground">{copy.packageChecklist}</h3>
          {result.attachmentChecklist.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {result.attachmentChecklist.map((attachment) => (
                <li key={attachment}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="size-4 accent-primary" />
                    {attachment}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-muted-foreground">{copy.packageNoAttachments}</p>
          )}
          <h3 className="m-0 text-xs font-medium text-muted-foreground">{copy.packageLetter}</h3>
          <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{result.coverLetter}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 min-w-0 flex-1 text-xs text-muted-foreground">{copy.packageNotice}</p>
        {props.children}
        {result ? (
          <Button asChild size="sm">
            <a href={result.pdfUrl} download="lotse-form.pdf">
              <DownloadIcon aria-hidden="true" />
              {copy.packageDownload}
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending || props.blocked}
            onClick={() => void create()}
          >
            {pending ? <Spinner aria-hidden="true" /> : <FileDownIcon aria-hidden="true" />}
            {pending ? copy.creatingPackage : copy.createPackage}
          </Button>
        )}
      </div>
    </section>
  );
}
