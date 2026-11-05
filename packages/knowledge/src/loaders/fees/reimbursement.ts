import { z } from "zod";
import { FeePositionSchema } from "./schema.ts";

const money = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER / 100)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    "Expected an amount in whole cents",
  );
const inputSchema = z.strictObject({ position: FeePositionSchema, paidAmount: money });

/** Illustrates the published rule; this does not determine an individual entitlement. */
export function explainReimbursement(input: z.input<typeof inputSchema>) {
  const { position, paidAmount } = inputSchema.parse(input);
  if (position.unit !== "EUR" || position.tariffKind !== "complete") {
    throw new RangeError(
      "Reimbursement requires a complete euro tariff, not points or a component",
    );
  }
  const contractTariff = money.parse(position.amount);
  const eightyPercentAmount = Math.round((Math.round(contractTariff * 100) * 80) / 100) / 100;
  return {
    contractTariff,
    eightyPercentAmount,
    paidAmount,
    currency: "EUR" as const,
    rate: 0.8,
    illustrative: true as const,
    binding: false as const,
    region: position.region,
    asOf: position.asOf,
    page: position.page,
    carrier: position.carrier,
    explanation: `Illustratives, unverbindliches Rechenbeispiel: Vertragstarif ${contractTariff.toFixed(2)} EUR; 80 % des Vertragstarifs sind ${eightyPercentAmount.toFixed(2)} EUR. Grundlage ist der Vertragstarif, nicht der Rechnungsbetrag (${paidAmount.toFixed(2)} EUR). Region: ${position.region}; Stand: ${position.asOf}. Daraus ergibt sich kein verbindlicher persönlicher Erstattungsanspruch.`,
  };
}
