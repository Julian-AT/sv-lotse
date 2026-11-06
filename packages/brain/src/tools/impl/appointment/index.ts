import type { RuntimeContext } from "../../../agent/context.ts";
import { searchAppointmentOptions } from "../../../directory/appointment-search.ts";
import { appointmentCalendar } from "../../../directory/calendar.ts";
import { confirmedFacts, officeContextData } from "../../../directory/context.ts";
import { canonicalOption } from "../../../directory/options.ts";
import { callDrafts, callRehearsal } from "../../../directory/prepare.ts";
import { DirectoryError } from "../../../directory/schema.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

async function prepare(deps: ToolDependencies, raw: unknown, context: RuntimeContext) {
  const input = contracts["appointment.prepare"].input.parse(raw);
  if (!context || input.caseId !== context.caseId) throw new DirectoryError("CASE_ACCESS_DENIED");
  const db = requireDatabase(deps);
  const option = await canonicalOption(db, input.option);
  const stored = await confirmedFacts(db, context);
  const ids = new Set(input.subjectFacts.map((fact) => fact.id));
  if (
    input.subjectFacts.some(
      (fact) => fact.subjectId !== context.subjectId || !stored.some((row) => row.id === fact.id),
    )
  )
    throw new DirectoryError("FACT_ACCESS_DENIED");
  const data = await officeContextData();
  const selected = stored.filter(
    (fact) => ids.has(fact.id) && data.administrative_fact_types.includes(fact.type),
  );
  const drafts = callDrafts(option, selected);
  return {
    ...drafts,
    ics: appointmentCalendar(input.caseId, option, new Date()),
    bookingValues: [],
  };
}
export function implementations(deps: ToolDependencies): Implementations {
  return {
    "appointment.search": (raw, context) =>
      searchAppointmentOptions(
        requireDatabase(deps),
        contracts["appointment.search"].input.parse(raw),
        context,
      ),
    "appointment.prepare": (raw, context) => prepare(deps, raw, context),
    "appointment.rehearse": async (raw, context) => {
      const input = contracts["appointment.rehearse"].input.parse(raw);
      const drafts = await prepare(deps, input, context);
      return callRehearsal(
        drafts.callSheet,
        await canonicalOption(requireDatabase(deps), input.option),
      );
    },
  };
}
