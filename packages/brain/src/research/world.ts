// Research-only: the AT-Benefits gym world, read from the loaded catalog. Never imported by apps.
import { readFile } from "node:fs/promises";
import type { DatabaseClient } from "@lotse/db";
import { benefits, offices, processes } from "@lotse/db/schema";
import { officeContextData } from "../directory/context.ts";
import type { BenefitRecord } from "../engine/catalog.ts";
import { type ProcessDefinition, processDefinitionSchema } from "../engine/schema.ts";
import { benefitRecordSchema } from "../tools/contracts/records.ts";

export type OfficeContext = Awaited<ReturnType<typeof officeContextData>>;
export type World = {
  benefits: BenefitRecord[];
  processes: ProcessDefinition[];
  /** Office table key → office record id. */
  offices: Map<string, string>;
  officeContext: OfficeContext;
  /** Austrian federal states, from the postcode directory (any other region value is abroad). */
  states: Set<string>;
};

const PROCESS_PREFIX = "ref:processes/";
const CATALOG_PREFIX = "ref:catalog/";

export async function loadWorld(db: DatabaseClient): Promise<World> {
  const [benefitRows, processRows, officeRows, officeContext] = await Promise.all([
    db.select({ record: benefits.record }).from(benefits),
    db.select({ record: processes.record }).from(processes),
    db.select({ key: offices.key, record: offices.record }).from(offices),
    officeContextData(),
  ]);
  const postcodes = JSON.parse(
    await readFile(new URL("../../../knowledge/data/postcodes-at.json", import.meta.url), "utf8"),
  ) as { postcodes: Record<string, { regions?: string[] }> };
  const states = new Set(
    Object.values(postcodes.postcodes).flatMap((entry) => entry.regions ?? []),
  );
  const records = benefitRows
    .map((row) => benefitRecordSchema.parse(row.record))
    .sort((left, right) => left.id.localeCompare(right.id));
  const definitions = processRows
    .map((row) => processDefinitionSchema.parse(row.record))
    .sort((left, right) => left.id.localeCompare(right.id));
  const officeIds = new Map<string, string>();
  for (const row of officeRows) {
    const id = (row.record as { id?: unknown }).id;
    officeIds.set(row.key, typeof id === "string" ? id : row.key);
  }
  if (records.length === 0) throw new Error("Catalog is empty; run the knowledge catalog loader");
  return { benefits: records, processes: definitions, offices: officeIds, officeContext, states };
}

export function benefitProcess(world: World, record: BenefitRecord): ProcessDefinition | undefined {
  const key = record.process.startsWith(PROCESS_PREFIX)
    ? record.process.slice(PROCESS_PREFIX.length)
    : record.process;
  return world.processes.find((definition) => definition.id === key);
}

export function processBenefit(
  world: World,
  definition: ProcessDefinition,
): BenefitRecord | undefined {
  const key = definition.benefit.startsWith(CATALOG_PREFIX)
    ? definition.benefit.slice(CATALOG_PREFIX.length)
    : definition.benefit;
  return world.benefits.find((record) => record.id === key);
}
