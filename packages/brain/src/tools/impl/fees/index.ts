import { basename } from "node:path";
import {
  type FeePosition,
  type FeeSchedule,
  loadFeeSchedules,
  loadReimbursementRules,
  type ReimbursementRules,
} from "@lotse/knowledge/loaders/fees";
import type { z } from "zod";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";
import { reimbursementCopy } from "./copy.ts";

type Input = z.infer<(typeof contracts)["fees.explainReimbursement"]["input"]>;
type Output = z.infer<(typeof contracts)["fees.explainReimbursement"]["output"]>;
type Candidate = { schedule: FeeSchedule; position: FeePosition };

export class FeeDataError extends Error {
  readonly code = "FEE_DATA_UNAVAILABLE";
  constructor() {
    super("FEE_DATA_UNAVAILABLE");
    this.name = "FeeDataError";
  }
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-AT");
}

function matchPositions(input: Input, schedules: FeeSchedule[]): Candidate[] {
  const code = normalize(input.tariffPositionId ?? "");
  const description = normalize(input.serviceDescription ?? "");
  if (!code && !description) return [];
  const byCode = schedules.flatMap((schedule) =>
    schedule.positions
      .filter((position) => !code || normalize(position.code) === code)
      .map((position) => ({ schedule, position })),
  );
  if (!description) return byCode;
  const exact = byCode.filter(({ position }) => normalize(position.title) === description);
  return exact.length > 0
    ? exact
    : byCode.filter(({ position }) => normalize(position.title).includes(description));
}

function explanationDetail(
  input: Input,
  candidates: Candidate[],
  amount: number | null,
  carrierMatches: boolean,
): string {
  const position = candidates.length === 1 ? candidates[0]?.position : undefined;
  if (position && amount !== null) return reimbursementCopy.example(position, amount);
  if (position && !carrierMatches) return reimbursementCopy.carrierMismatch;
  if (position) return reimbursementCopy.unsupported;
  if (candidates.length > 1) return reimbursementCopy.ambiguous;
  if (input.tariffPositionId || input.serviceDescription) return reimbursementCopy.notFound;
  return reimbursementCopy.unspecified;
}

function explain(input: Input, schedules: FeeSchedule[], rules: ReimbursementRules): Output {
  const candidates = matchPositions(input, schedules);
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  const position = candidate?.position;
  const carrierMatches =
    position?.carrier.split("/").some((carrier) => carrier.trim() === rules.carrier) ?? false;
  const usable = position?.unit === "EUR" && position.tariffKind === "complete" && carrierMatches;
  const amount = usable ? Math.round(position.amount * 100 * rules.rate) / 100 : null;
  const detail = explanationDetail(input, candidates, amount, carrierMatches);
  return {
    ruleText: [rules.ruleText, rules.scopeText, detail, rules.submissionText].join(" "),
    requiredDocuments: [...rules.requiredDocuments],
    channels: { onlineUrl: rules.onlineUrl },
    illustrativeAmount: amount,
    asOf: position?.asOf ?? rules.asOf,
    illustrative: true,
    sources: [
      ...rules.sources,
      ...(candidate
        ? [
            {
              url: `${rules.scheduleBaseUrl}${encodeURIComponent(basename(candidate.schedule.file))}#page=${candidate.position.page}`,
              quote: candidate.position.sourceQuote,
              asOf: candidate.position.asOf,
            },
          ]
        : []),
    ],
  };
}

export function implementations(_deps: ToolDependencies): Implementations {
  let loading: Promise<readonly [FeeSchedule[], ReimbursementRules]> | undefined;
  const snapshot = (): NonNullable<typeof loading> => {
    loading ??= Promise.all([loadFeeSchedules(), loadReimbursementRules()]).catch(() => {
      loading = undefined;
      throw new FeeDataError();
    });
    return loading;
  };
  return {
    "fees.explainReimbursement": async (input) => {
      const parsed = contracts["fees.explainReimbursement"].input.parse(input);
      const [schedules, rules] = await snapshot();
      return explain(parsed, schedules, rules);
    },
  };
}
