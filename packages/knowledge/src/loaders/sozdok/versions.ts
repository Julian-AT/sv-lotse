import { type SozdokRecord, sozdokDate } from "./parse.ts";

export interface SozdokVersion extends SozdokRecord {
  /** Exclusive upper bound: the next version's first day in force. */
  in_force_to: string | null;
}

type Provision = Pick<SozdokRecord, "law_abbr" | "gldart" | "paragraph">;

export function provisionKey(record: Provision): string {
  return JSON.stringify([record.law_abbr, record.gldart, record.paragraph.gldnr]);
}

export function groupVersions<T extends Provision & Pick<SozdokRecord, "in_force_from" | "file">>(
  records: readonly T[],
): Map<string, (T & { in_force_to: string | null })[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    sozdokDate.parse(record.in_force_from);
    const key = provisionKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return new Map(
    [...groups].map(([key, records]) => {
      const sorted = records.toSorted((a, b) => a.in_force_from.localeCompare(b.in_force_from));
      const versions = sorted.map((record, index) => {
        const next = sorted[index + 1];
        if (next?.in_force_from === record.in_force_from)
          throw new Error(`Ambiguous SozDok versions: ${record.file}, ${next.file}`);
        return { ...record, in_force_to: next?.in_force_from ?? null };
      });
      return [key, versions];
    }),
  );
}

export function inForceOn(
  versions: readonly SozdokVersion[],
  date: string,
): SozdokVersion | undefined {
  sozdokDate.parse(date);
  return versions.find(
    (version) =>
      version.in_force_from <= date && (version.in_force_to === null || date < version.in_force_to),
  );
}
