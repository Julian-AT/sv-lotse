export const directoryCopy = {
  de: {
    hoursUnknown: "Öffnungszeiten nicht bekannt; bitte bei der Stelle nachfragen.",
    noBooking:
      "Kontaktmöglichkeit, kein bestätigter freier Termin. Es wurde nichts gebucht oder versendet.",
    hold: "Unbestätigter Terminwunsch – bitte mit der Stelle vereinbaren",
    holdMissing: "Für einen Kalendervormerk bitte zuerst einen gewünschten Zeitraum angeben.",
    callTitle: "Spickzettel für den Anruf",
    introduction:
      "Guten Tag. Ich möchte die nächsten organisatorischen Schritte und einen Termin klären.",
    questions: [
      "Bin ich bei Ihnen richtig?",
      "Welche Unterlagen soll ich bereithalten?",
      "Welche Termine sind möglich?",
      "Sind meine Wünsche zu Sprache und Barrierefreiheit möglich?",
      "Können Sie die Vereinbarung und die benötigten Unterlagen bitte bestätigen?",
    ],
    emailSubject: "Betreff: Anfrage zu Termin und benötigten Unterlagen",
    emailGreeting: "Guten Tag,",
    emailBody:
      "ich möchte die nächsten organisatorischen Schritte und einen Termin mit Ihnen klären. Welche Unterlagen benötigen Sie? Bitte teilen Sie mir mit, welche Termine möglich sind und ob meine Wünsche zu Sprache und Barrierefreiheit berücksichtigt werden können.",
    emailClosing: "Vielen Dank.\nMit freundlichen Grüßen\n[Name bitte ergänzen]",
    details: "Bestätigte organisatorische Angaben",
    recipient: "Kontakt",
    preferences: "Gewünschter Zeitraum (noch nicht bestätigt)",
    language: "Gewünschte Sprache (bitte bestätigen)",
    accessibility: "Gewünschte Barrierefreiheit (bitte bestätigen)",
    weekdays: {
      monday: "Montag",
      tuesday: "Dienstag",
      wednesday: "Mittwoch",
      thursday: "Donnerstag",
      friday: "Freitag",
      saturday: "Samstag",
      sunday: "Sonntag",
      notes: "Hinweise",
    } as Record<string, string>,
    rehearsalNotice:
      "Übungsgespräch: Die Antworten der Stelle sind nur Rollen im Übungsskript. Es findet kein echter Anruf statt.",
    rehearsalClerk: "Guten Tag. Welche organisatorische Frage möchten Sie klären?",
    rehearsalDocuments:
      "Bitte fragen Sie im echten Gespräch nach den Unterlagen und verfügbaren Terminen.",
    rehearsalClose: "Wiederholen Sie zum Abschluss Datum, Uhrzeit, Ort und vereinbarte Unterlagen.",
  },
  en: {
    introduction:
      "Hello. I would like to clarify the next administrative steps and an appointment.",
    questions: [
      "Am I contacting the right office?",
      "Which documents should I have ready?",
      "Which appointments are possible?",
      "Can you accommodate my language and accessibility preferences?",
      "Could you confirm the arrangement and required documents?",
    ],
    preferences: "Preferred time (not confirmed)",
    rehearsalNotice:
      "Practice conversation: the office replies are roles in a practice script. No real call is made.",
    rehearsalClerk: "Hello. Which administrative question would you like to clarify?",
    rehearsalDocuments:
      "Please ask about documents and available appointments during the real conversation.",
    rehearsalClose: "Finish by repeating the date, time, place and agreed documents.",
    hoursUnknown: "Opening hours unknown; please ask the provider.",
    noBooking:
      "Contact channel, not a confirmed available appointment. Nothing was booked or sent.",
  },
} as const;
