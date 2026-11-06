const labels: Record<string, { de: string; en: string }> = {
  "calendar.createEvent": { de: "Termin anlegen", en: "Create calendar event" },
  "case.update": { de: "Fall aktualisieren", en: "Update case" },
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
  "ui.point": { de: "Zeigen", en: "Point" },
};

/** Human tool title for the collapsible tool card; unknown tools fall back to their name. */
export function toolLabel(name: string, language: "de" | "en"): string {
  const entry = labels[name];
  if (entry) return entry[language];
  if (/knowledge|search|retriev/i.test(name))
    return language === "de" ? "Quellen durchsuchen" : "Search sources";
  if (/benefit|eligib/i.test(name))
    return language === "de" ? "Leistungen prüfen" : "Check benefits";
  return name.replace(/[._-]+/g, " ");
}
