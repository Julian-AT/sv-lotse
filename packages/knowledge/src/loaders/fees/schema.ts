import { z } from "zod";

const text = z.string().trim().min(1);
export const FeePositionSchema = z.strictObject({
  code: text,
  title: text,
  amount: z.number().finite().nonnegative(),
  unit: z.enum(["EUR", "points"]),
  section: text,
  region: text,
  asOf: z.iso.date(),
  page: z.number().int().positive(),
  carrier: text,
  tariffKind: z.enum(["complete", "component"]),
  sourceQuote: text,
});
export type FeePosition = z.infer<typeof FeePositionSchema>;
export type ScheduleKind = "styria" | "dental";
export interface FeeSchedule {
  kind: ScheduleKind;
  file: string;
  pageCount: number;
  positions: FeePosition[];
  candidateCount: number;
  parsedCount: number;
  coverage: number;
  unparsed: { code: string; page: number }[];
}
