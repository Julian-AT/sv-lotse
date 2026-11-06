export const coverageCopy = {
  mixed:
    "Die EKO-Zuordnung unterscheidet sich zwischen Packungen desselben exakt benannten Produkts. Eine gemeinsame Box kann nicht angegeben werden; die verordnete Packung entscheidet. Die Bewilligungsangabe zeigt, ob mindestens eine dieser Packungen eine vorherige Bewilligung erfordert.",
  absent:
    "Der exakte Produktname wurde im bereitgestellten EKO-Auszug nicht gefunden. Daraus folgt weder eine rote Box noch eine Ablehnung der Kostenübernahme. Bitte den vollständigen Produktnamen von der Verordnung prüfen; es werden keine anderen Produkte vorgeschlagen.",
  snapshot: (reviewedAt: string): string =>
    `EKO-Abgleich mit dem bereitgestellten SV-Box-Auszug; dessen Gültigkeitsdatum ist nicht dokumentiert. Quellenprüfung: ${reviewedAt}. Keine Live-Abfrage oder Zusage aktueller Kostenübernahme.`,
  fee: (amountCents: number, year: number, asOf: string): string =>
    `Rezeptgebühr ${year}: ${(amountCents / 100).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR je Packung; Stand: ${asOf}.`,
} as const;
