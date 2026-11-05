import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseFeePages } from "./parser.ts";
import { readFeePages } from "./pdf.ts";
import type { FeeSchedule, ScheduleKind } from "./schema.ts";

export { loadReimbursementRules, type ReimbursementRules } from "./administration.ts";
export { explainReimbursement } from "./reimbursement.ts";
export { type FeePosition, FeePositionSchema, type FeeSchedule } from "./schema.ts";

/** Reads the original SV-Box files without copying or modifying them. */
export async function loadFeeSchedules(): Promise<FeeSchedule[]> {
  const env = z.object({ SVBOX_DIR: z.string().trim().min(1).optional() }).parse(process.env);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
  const root = resolve(repositoryRoot, env.SVBOX_DIR ?? "data/svbox");
  const directory = resolve(root, "Leistungskataloge");
  const files = await readdir(directory);
  const schedules: FeeSchedule[] = [];
  for (const kind of ["styria", "dental"] as const) {
    const matches = files.filter((name) =>
      (kind === "styria"
        ? /^ÖGK Honorarordnung.*\.pdf$/
        : /^Zahnärzte Honorarordnung_2026.*\.pdf$/
      ).test(name),
    );
    if (matches.length !== 1)
      throw new Error(`Expected exactly one ${kind} schedule in SVBOX_DIR/Leistungskataloge`);
    const name = matches[0];
    if (!name) throw new Error(`Missing ${kind} schedule`);
    schedules.push(await loadFeeSchedule(resolve(directory, name), kind));
  }
  return schedules;
}

export async function loadFeeSchedule(file: string, kind: ScheduleKind): Promise<FeeSchedule> {
  const validated = z.tuple([z.string().min(1), z.enum(["styria", "dental"])]).parse([file, kind]);
  const pages = await readFeePages(validated[0]);
  return parseFeePages(pages, validated[1], validated[0]);
}
