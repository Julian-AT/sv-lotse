const sexLabels: Record<string, string> = {
  female: "Frauen",
  male: "Männer",
  diverse: "Personen mit Geschlechtseintrag divers",
  all: "alle Personen",
};

export const catalogCopy = {
  de: {
    additionalSituation: (label: string, key: string): string =>
      label === key
        ? `Weitere Lebenssituation: ${key}.`
        : `Weitere Lebenssituation: ${label} (${key}).`,
    bundle: (label: string, key: string, scope: string): string =>
      label === key
        ? `Lebenssituation: ${key}. Bereich: ${scope}.`
        : `Lebenssituation: ${label} (${key}). Bereich: ${scope}.`,
    scopes: {
      social_insurance: "Sozialversicherung",
      federal: "Bund (außerhalb der Sozialversicherung)",
      state: "Land (außerhalb der Sozialversicherung)",
      municipality: "Gemeinde (außerhalb der Sozialversicherung)",
      other: "Weitere Angebote außerhalb der Sozialversicherung",
    },
    age: (min?: number, max?: number): string =>
      `Veröffentlichte Altersgruppe: ${min ?? 0} bis ${max ?? "ohne Obergrenze"} Jahre.`,
    sex: (sex: string): string => `Veröffentlichte Zielgruppe: ${sexLabels[sex] ?? sex}.`,
    interval: (interval: string): string =>
      `Veröffentlichtes Intervall: ${interval}. Daraus wird kein persönlicher Fälligkeitstermin abgeleitet.`,
    rationale: (text: string): string => `Zweck des Programms laut Quelle: „${text}“`,
    familyHistory: (criteria: string[]): string =>
      `Das Programm nennt folgende Familienanamnese: ${criteria.join("; ")}. Ein früherer Beginn und individuelle Entscheidungen sind mit der behandelnden Ärztin oder dem behandelnden Arzt zu klären. Dafür kann ein Arzttermin vorbereitet werden.`,
    match: "Die bestätigten Angaben erfüllen dieses veröffentlichte Zielgruppenkriterium.",
    unknown:
      "Für dieses veröffentlichte Zielgruppenkriterium fehlen eindeutige bestätigte Angaben.",
    notMet: "Die vorliegenden Angaben erfüllen dieses veröffentlichte Zielgruppenkriterium nicht.",
    vaccinationMissing:
      "Es liegen keine bestätigten Impfeinträge aus einem importierten Impfpass vor. Daraus lässt sich kein Impfstatus ableiten. Sie können den Impfpass importieren und die Einträge bestätigen.",
    vaccination: (page: number, quote: string): string =>
      `Dokumentierter Impfeintrag, Seite ${page}: „${quote}“`,
    vaccinationBoundary:
      "Dies sind dokumentierte Einträge. Vollständigkeit, Impfschutz, Impfstoffwahl und weitere Impftermine klären Sie mit Ihrer Ärztin oder Ihrem Arzt.",
  },
} as const;
