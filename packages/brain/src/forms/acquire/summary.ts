import type { DatabaseClient } from "@lotse/db";
import { formTemplates } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { contracts } from "../../tools/contracts/index.ts";
import { formCopy } from "../copy.ts";
import { formHistory } from "../history.ts";
import { officialOrigins, officialUrl } from "./http.ts";

/** Never download the candidate to produce a consent prompt. */
export async function acquisitionSummary(
  db: DatabaseClient,
  caseId: string,
  raw: unknown,
  language: "de" | "en" = "de",
): Promise<string> {
  const { url } = contracts["form.acquire"].input.parse(raw);
  const canonical = officialUrl(url, await officialOrigins());
  const history = await formHistory(db, caseId);
  for (const part of history) {
    if (part.type !== "tool-form.find") continue;
    const candidates = contracts["form.find"].output.safeParse(part.output);
    const candidate = candidates.success
      ? candidates.data.find((item) => item.url === canonical.href)
      : undefined;
    if (candidate) return formCopy[language].acquireSummary(candidate);
  }
  const [known] = await db
    .select()
    .from(formTemplates)
    .where(eq(formTemplates.source, canonical.href));
  return formCopy[language].acquireSummary({
    publisher: known?.publisher ?? canonical.hostname,
    title: known?.title ?? decodeURIComponent(canonical.pathname.split("/").at(-1) ?? ""),
    versionDate: known?.versionDate ?? null,
    url: canonical.href,
  });
}
