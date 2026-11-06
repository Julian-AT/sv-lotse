export const controlCopy = {
  de: {
    propose: (level: string): string =>
      `Möchten Sie zu ${level} wechseln? Bitte bestätigen Sie die Autonomiestufe. Bis dahin bleibt die bisherige Stufe aktiv.`,
    changed: (level: string): string =>
      `Autonomiestufe ${level} gespeichert. Jede freigabepflichtige Aktion braucht weiterhin Ihre Zustimmung.`,
    declined: "Die Autonomiestufe bleibt unverändert.",
    noPending: "Es ist kein Stufenwechsel zur Bestätigung offen.",
    paused: "Teilen ist pausiert. Die helfende Person erhält keinen weiteren Fallkontext.",
    noSharing: "Für diesen Fall ist keine aktive Freigabe zum Pausieren vorhanden.",
    forbidden: "Nur die Person, die den Fall freigibt, kann diese Einstellung ändern.",
  },
  en: {
    propose: (level: string): string =>
      `Would you like to switch to ${level}? Please confirm the autonomy level. The current level stays active until then.`,
    changed: (level: string): string =>
      `Autonomy level ${level} saved. Every action requiring approval still needs your consent.`,
    declined: "The autonomy level remains unchanged.",
    noPending: "There is no autonomy change awaiting confirmation.",
    paused: "Sharing is paused. The helper will receive no further case context.",
    noSharing: "There is no active sharing session to pause for this case.",
    forbidden: "Only the person sharing the case can change this setting.",
  },
};
