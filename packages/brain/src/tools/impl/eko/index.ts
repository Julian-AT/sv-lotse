import {
  type CoverageResult,
  type Eko,
  type EkoAdministration,
  loadEko,
  loadEkoAdministration,
} from "@lotse/knowledge/loaders/eko";
import type { z } from "zod";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";
import { coverageCopy } from "./copy.ts";

type CoverageOutput = z.infer<(typeof contracts)["eko.lookupCoverage"]["output"]>;
type Box = NonNullable<CoverageOutput["box"]>;
const boxes: Record<CoverageResult["packs"][number]["box"], Box> = {
  green: "green",
  "yellow-re1": "yellow_re1",
  "yellow-re2": "yellow_re2",
  red: "red",
};

export class CoverageDataError extends Error {
  readonly code = "EKO_DATA_UNAVAILABLE";
  constructor() {
    super("EKO_DATA_UNAVAILABLE");
    this.name = "CoverageDataError";
  }
}

function projectCoverage(
  result: CoverageResult,
  data: EkoAdministration,
  eko: Eko,
): CoverageOutput {
  const boxSet = new Set(result.packs.map((pack) => boxes[pack.box]));
  const needsRequester = result.packs.some(
    (pack) => pack.approvalRequestedBy === "prescribing-doctor",
  );
  const notices = [coverageCopy.snapshot(data.reviewedAt)];
  if (!result.listed) notices.push(coverageCopy.absent);
  if (boxSet.size > 1) notices.push(coverageCopy.mixed);
  if (result.packs.some((pack) => pack.conditionsFlag)) notices.push(data.conditional);
  if (result.packs.some((pack) => pack.box === "yellow-re2")) notices.push(data.subsequentControl);
  return {
    listed: result.listed,
    box: boxSet.size === 1 ? ([...boxSet][0] ?? null) : null,
    approvalRequired: result.packs.some((pack) => pack.approvalRequired),
    approvalRequestedBy: needsRequester ? data.requester : null,
    conditionsFlag: result.packs.some((pack) => pack.conditionsFlag),
    prescriptionFee: coverageCopy.fee(
      result.prescriptionFee.amountCents,
      result.prescriptionFee.year,
      result.prescriptionFee.asOf,
    ),
    capRule: result.capRule.text,
    // The frozen contract has no separate notice field; retain qualifications here.
    exemptionRule: [result.exemptionRule, ...notices].join(" "),
    sources: [
      ...result.sources.map(({ url, quote, asOf }) => ({ url, quote, asOf })),
      ...data.sources,
      ...result.packs.flatMap((pack) => {
        const quote = eko.coverageQuote(pack.pharmaNumber);
        return quote
          ? [
              {
                url: `${data.exportUrl}#pharmaNumber=${pack.pharmaNumber}`,
                quote,
                asOf: data.reviewedAt,
              },
            ]
          : [];
      }),
      ...result.packs.flatMap((pack) =>
        pack.ruleText
          ? [
              {
                url: `${data.rulesUrl}#pharmaNumber=${pack.pharmaNumber}`,
                quote: pack.ruleText,
                // This is the review date, explicitly qualified by the snapshot notice.
                asOf: data.reviewedAt,
              },
            ]
          : [],
      ),
    ],
  };
}

export function implementations(_deps: ToolDependencies): Implementations {
  let loading:
    | Promise<readonly [Awaited<ReturnType<typeof loadEko>>, EkoAdministration]>
    | undefined;
  const snapshot = (): NonNullable<typeof loading> => {
    loading ??= Promise.all([loadEko(), loadEkoAdministration()]).catch(() => {
      loading = undefined;
      throw new CoverageDataError();
    });
    return loading;
  };
  return {
    "eko.lookupCoverage": async (input) => {
      const parsed = contracts["eko.lookupCoverage"].input.parse(input);
      const [eko, data] = await snapshot();
      return projectCoverage(eko.lookupCoverage(parsed), data, eko);
    },
  };
}
