import type { DatabaseClient } from "@lotse/db";
import { benefits, subjects } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../../agent/context.ts";
import { DIRECTORY_CONFIG } from "../../config/index.ts";
import { contracts } from "../../tools/contracts/index.ts";
import { formCopy } from "../copy.ts";
import { formHistory } from "../history.ts";
import type { Template } from "../schema.ts";

const AttachmentRecord = z.object({
  forms: z.array(z.union([z.string(), z.object({ search: z.string(), publisher: z.string() })])),
  documents: z.array(z.object({ name_de: z.string().min(1), required: z.boolean() })),
});

function templateSearches(
  history: Awaited<ReturnType<typeof formHistory>>,
  template: Template,
): string[] {
  return history.flatMap((part) => {
    if (part.type !== "tool-form.find") return [];
    const input = contracts["form.find"].input.safeParse(part.input);
    const output = contracts["form.find"].output.safeParse(part.output);
    return input.success &&
      output.success &&
      output.data.some(
        (candidate) => candidate.templateId === template.id || candidate.url === template.source,
      )
      ? [input.data.need]
      : [];
  });
}

export async function packageLetter(
  db: DatabaseClient,
  template: Template,
  context: RuntimeContext,
): Promise<{ attachmentChecklist: string[]; coverLetter: string }> {
  const history = await formHistory(db, context.caseId);
  const searches = templateSearches(history, template);
  const records = await db.select({ key: benefits.key, record: benefits.record }).from(benefits);
  const linked = records.flatMap(({ key, record }) => {
    const parsed = AttachmentRecord.safeParse(record);
    return parsed.success &&
      parsed.data.forms.some((form) =>
        typeof form === "string"
          ? form === `ref:forms/${template.schema.id}` || form === `ref:forms/${template.id}`
          : searches.includes(form.search),
      )
      ? [{ key, ...parsed.data }]
      : [];
  });
  const attachmentChecklist = [
    ...new Set(
      linked.flatMap((record) =>
        record.documents
          .filter((document) => document.required)
          .map((document) => document.name_de),
      ),
    ),
  ];
  let recipient: string | null = null;
  for (const part of history) {
    if (part.type !== "tool-office.resolve") continue;
    const input = contracts["office.resolve"].input.safeParse(part.input);
    const output = contracts["office.resolve"].output.safeParse(part.output);
    if (
      !input.success ||
      !output.success ||
      !linked.some((item) => item.key === input.data.benefitId)
    )
      continue;
    const { title, address } = output.data;
    recipient = [title, address.street, `${address.postalCode} ${address.city}`.trim()]
      .filter(Boolean)
      .join("\n");
    break;
  }
  const [subject] = await db
    .select({ name: subjects.displayName })
    .from(subjects)
    .where(eq(subjects.id, context.subjectId));
  const language = context.responsePreferences?.language === "en" ? "en" : "de";
  return {
    attachmentChecklist,
    coverLetter: formCopy[language].coverLetter({
      title: template.title,
      subjectName: subject?.name ?? "",
      date: new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-AT", {
        timeZone: DIRECTORY_CONFIG.timeZone,
        dateStyle: "long",
      }).format(new Date()),
      recipient,
      attachments: attachmentChecklist,
    }),
  };
}
