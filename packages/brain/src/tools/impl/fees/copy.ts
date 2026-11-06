import type { FeePosition } from "@lotse/knowledge/loaders/fees";

export const reimbursementCopy = {
  unspecified: "Für ein Rechenbeispiel ist eine eindeutig bezeichnete Tarifposition erforderlich.",
  notFound:
    "Die angegebene Leistung oder Tarifposition konnte in diesen Beispieltarifen nicht eindeutig zugeordnet werden. Bitte die Tarifposition und genaue Leistungsbezeichnung aus der Honorarnote prüfen; es wird kein Betrag geschätzt.",
  ambiguous:
    "Die Angaben passen zu mehreren Tarifzeilen, Trägern oder Varianten. Ohne eindeutige Zuordnung wird kein Betrag ausgewählt. Bitte Tarifposition, genaue Leistungsbezeichnung und zuständigen Träger klären.",
  unsupported:
    "Die zugeordnete Position enthält Punkte oder nur einen Tarifbestandteil. Daraus lässt sich hier kein vollständiger Euro-Vertragstarif ableiten; es wird kein Erstattungsbetrag geschätzt.",
  carrierMismatch:
    "Die Tarifzeile gilt für einen anderen Träger. Die genannte ÖGK-Regel wird darauf nicht angewendet; bitte die Bedingungen beim zuständigen Träger klären.",
  example: (position: FeePosition, amount: number): string =>
    `Illustratives, unverbindliches Rechenbeispiel: Vertragstarif ${position.amount.toFixed(2)} EUR; daraus ${amount.toFixed(2)} EUR nach der genannten ÖGK-Regel. Region: ${position.region}; Träger laut Tarif: ${position.carrier}; Stand: ${position.asOf}. Dies ist kein persönlicher Erstattungsanspruch.`,
} as const;
