import { benefits, offices } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { selectOfficeReference } from "../../../directory/conditions.ts";
import { confirmedFacts, officeSlots } from "../../../directory/context.ts";
import { openingHours, recordAddress, recordSources } from "../../../directory/records.ts";
import {
  DirectoryError,
  directoryBenefitSchema,
  directoryRecordSchema,
} from "../../../directory/schema.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "office.resolve": async (raw, context) => {
      const input = contracts["office.resolve"].input.parse(raw);
      const db = requireDatabase(deps);
      const [row] = await db
        .select({ record: benefits.record })
        .from(benefits)
        .where(eq(benefits.key, input.benefitId));
      if (!row) throw new DirectoryError("BENEFIT_NOT_FOUND");
      const benefit = directoryBenefitSchema.parse(row.record);
      const slots = await officeSlots(input, context ? await confirmedFacts(db, context) : []);
      const reference = selectOfficeReference(benefit.office_rules, slots);
      if (!reference?.startsWith("ref:offices/")) throw new DirectoryError("OFFICE_NOT_FOUND");
      const [office] = await db
        .select({ record: offices.record })
        .from(offices)
        .where(eq(offices.key, reference.slice("ref:offices/".length)));
      if (!office) throw new DirectoryError("OFFICE_NOT_FOUND");
      const record = directoryRecordSchema.parse(office.record);
      return {
        id: record.id,
        title: record.name_de,
        address: recordAddress(record),
        channels: {
          ...(record.phone ? { phone: record.phone } : {}),
          ...(record.email ? { email: record.email } : {}),
        },
        openingHours: openingHours(record),
        sources: [...recordSources(record), ...recordSources(benefit)],
      };
    },
  };
}
