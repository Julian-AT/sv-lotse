const labels: Record<string, { de: string; en: string }> = {
  "calendar.createEvent": { de: "Termin anlegen", en: "Create calendar event" },
  "case.update": { de: "Fall aktualisieren", en: "Update case" },
  "catalog.findBenefits": { de: "Leistungen suchen", en: "Find benefits" },
  "catalog.getBenefit": { de: "Leistung nachschlagen", en: "Look up benefit" },
  "documents.checklist": { de: "Dokumente prüfen", en: "Check documents" },
  "eko.lookupCoverage": { de: "Kostenübernahme prüfen", en: "Check coverage" },
  "fees.explainReimbursement": { de: "Erstattung erklären", en: "Explain reimbursement" },
  "form.acquire": { de: "Formular besorgen", en: "Acquire form" },
  "form.analyze": { de: "Formular analysieren", en: "Analyse form" },
  "form.commitGroup": { de: "Formularangaben übernehmen", en: "Commit form fields" },
  "form.fillLive": { de: "Formular live ausfüllen", en: "Fill form live" },
  "form.find": { de: "Formular suchen", en: "Find form" },
  "form.getSchema": { de: "Formularfelder lesen", en: "Read form fields" },
  "form.prefill": { de: "Formular vorausfüllen", en: "Prefill form" },
  "office.resolve": { de: "Zuständige Stelle finden", en: "Find responsible office" },
  "reminder.create": { de: "Erinnerung anlegen", en: "Create reminder" },
  "reminder.extract": { de: "Fristen erkennen", en: "Detect deadlines" },
  "reminder.list": { de: "Erinnerungen anzeigen", en: "List reminders" },
  "ui.annotate": { de: "Hinweis einblenden", en: "Annotate" },
  "ui.caption": { de: "Untertitel", en: "Caption" },
  "ui.fill": { de: "Feld ausfüllen", en: "Fill field" },
  "ui.highlight": { de: "Hervorheben", en: "Highlight" },
  "ui.offerResource": { de: "Öffnen anbieten", en: "Offer to open" },
  "ui.openResource": { de: "Seite öffnen", en: "Open page" },
  "ui.click": { de: "Auf der Seite weiter", en: "Navigate the page" },
  "ui.scroll": { de: "Seite scrollen", en: "Scroll the page" },
  "ui.point": { de: "Zeigen", en: "Point" },
  "web.findOfficialPage": { de: "Offizielle Seite suchen", en: "Find official page" },
};

const normalize = (name: string) =>
  name
    .replace(/^(lotse|mcp)[._-]+/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const byNormalizedName = new Map(
  Object.entries(labels).map(([key, value]) => [normalize(key), value]),
);

function humanize(name: string): string {
  const words = name
    .replace(/^(lotse|mcp)[._-]+/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human tool title for the tool row; accepts dotted (`office.resolve`) and raw (`lotse_office_resolve`) names. */
export function toolLabel(name: string, language: "de" | "en"): string {
  const entry = labels[name] ?? byNormalizedName.get(normalize(name));
  if (entry) return entry[language];
  if (/knowledge|search|retriev/i.test(name))
    return language === "de" ? "Wissen durchsuchen" : "Search knowledge";
  if (/benefit|eligib/i.test(name))
    return language === "de" ? "Leistungen suchen" : "Find benefits";
  return humanize(name);
}
