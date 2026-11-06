const stepTitles: Record<"de" | "en", Readonly<Record<string, string>>> = {
  de: {
    "office.resolve": "Zuständige Stelle finden",
    "docs.extractStatements": "Dokument sichten",
    "kb.search": "Informationen sammeln",
    "process.start": "Vorgehen klären",
    "documents.checklist": "Unterlagen prüfen",
    "form.find": "Formular finden",
    "form.acquire": "Formular bereitstellen",
    "form.getSchema": "Formular vorbereiten",
    "form.prefill": "Antrag vorbereiten",
    "form.commitGroup": "Angaben bestätigen",
    "package.build": "Antragsunterlagen zusammenstellen",
    "facility.search": "Einrichtung finden",
    "appointment.search": "Kontaktmöglichkeiten finden",
    "appointment.prepare": "Termin vorbereiten",
    "handoff.compose": "Übergabe vorbereiten",
    "reminder.create": "Erinnerung vorbereiten",
  },
  en: {
    "office.resolve": "Find the responsible office",
    "docs.extractStatements": "Review document",
    "kb.search": "Gather information",
    "process.start": "Clarify the process",
    "documents.checklist": "Check documents",
    "form.find": "Find form",
    "form.acquire": "Obtain form",
    "form.getSchema": "Prepare form",
    "form.prefill": "Prepare application",
    "form.commitGroup": "Confirm information",
    "package.build": "Prepare application package",
    "facility.search": "Find a facility",
    "appointment.search": "Find contact options",
    "appointment.prepare": "Prepare appointment",
    "handoff.compose": "Prepare handoff",
    "reminder.create": "Prepare reminder",
  },
};
const untitledStep = { de: "Nächster Schritt", en: "Next step" };

export function journeyStepTitle(title: string, language: "de" | "en"): string {
  return stepTitles[language][title] ?? (/\s/.test(title) ? title : untitledStep[language]);
}
