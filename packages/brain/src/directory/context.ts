import { readFile } from "node:fs/promises";
import type { DatabaseClient } from "@lotse/db";
import { facts } from "@lotse/db/schema";
import { type Fact, FactSchema } from "@lotse/protocol";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";

const mappingSchema = z.object({
  aliases: z.record(z.string(), z.array(z.string())),
  carrier_aliases: z.record(z.string(), z.string()),
  status_values: z.record(z.string(), z.record(z.string(), z.string())),
  administrative_fact_types: z.array(z.string()),
});

let mapping: Promise<z.infer<typeof mappingSchema>> | undefined;
export async function officeContextData(): Promise<z.infer<typeof mappingSchema>> {
  mapping ??= readFile(
    new URL("../../../knowledge/data/office-context.json", import.meta.url),
    "utf8",
  ).then((text) => mappingSchema.parse(JSON.parse(text)));
  return mapping;
}

export function factAllowed(type: string, context: RuntimeContext): boolean {
  const scope = context.shareScope.facts;
  return (
    context.actorRole === "subject" ||
    scope === true ||
    (Array.isArray(scope) && scope.includes(type))
  );
}

export async function confirmedFacts(db: DatabaseClient, context: RuntimeContext): Promise<Fact[]> {
  const rows = await db
    .select()
    .from(facts)
    .where(and(eq(facts.subjectId, context.subjectId), eq(facts.confirmed, true)));
  return rows
    .filter((row) => factAllowed(row.type, context))
    .map((row) =>
      FactSchema.parse({
        id: row.id,
        subjectId: row.subjectId,
        type: row.type,
        value: row.value,
        source: row.source,
        confidence: row.confidence,
        confirmed: row.confirmed,
      }),
    );
}

export async function officeSlots(
  input: { carrier: string; region: string; subjectStatus: string },
  existing: readonly Fact[] = [],
): Promise<Record<string, unknown>> {
  const data = await officeContextData();
  const slots: Record<string, unknown> = {};
  const carrier =
    data.carrier_aliases[input.carrier.toLocaleLowerCase("de-AT")] ?? input.carrier.toLowerCase();
  for (const [field, value] of Object.entries({ ...input, carrier })) {
    for (const alias of data.aliases[field] ?? []) slots[alias] = value;
  }
  const status = input.subjectStatus.toLowerCase();
  Object.assign(
    slots,
    data.status_values[status === "pensioner" ? `${status}:${carrier}` : status],
  );
  // Explicit confirmed catalog slots take precedence over coarse status defaults.
  const grouped = new Map<string, unknown[]>();
  for (const fact of existing) {
    const key = fact.type.split(".").at(-1) ?? fact.type;
    if (key in input) continue;
    const values = grouped.get(key) ?? [];
    values.push(fact.value);
    grouped.set(key, values);
  }
  for (const [key, values] of grouped)
    slots[key] = values.every((value) => value === values[0]) ? values[0] : null;
  return slots;
}
