export const shellCopy = {
  de: {
    skip: "Zum Inhalt",
    navigation: "Sprache",
    settings: "Einstellungen",
    reset: "Neue Sitzung",
    resetting: "Sitzung wird erneuert …",
    resetDone: "Neue Sitzung gestartet.",
    resetError: "Die Sitzung konnte nicht erneuert werden. Bitte versuchen Sie es erneut.",
    resetHelp:
      "Starten Sie mit einer neuen, anonymen Sitzung. Bisherige Daten werden dabei nicht gelöscht.",
    eyebrow: "Orientierung im Sozialversicherungssystem",
    title: "Ihr nächster Schritt. In Ihrem Tempo.",
    introduction:
      "Der SV KI-Lotse begleitet Sie bei Fragen zu Leistungen, Anträgen und zuständigen Stellen in Österreich.",
    privacy: "Sie starten ohne Anmeldung mit einer anonymen Sitzung.",
    boundary:
      "Für medizinische Fragen wenden Sie sich bitte an Ihre behandelnden Ärztinnen und Ärzte.",
    footer: "SV KI-Lotse · Orientierung und Begleitung",
  },
  en: {
    skip: "Skip to content",
    navigation: "Language",
    settings: "Settings",
    reset: "New session",
    resetting: "Starting a new session …",
    resetDone: "New session started.",
    resetError: "The session could not be renewed. Please try again.",
    resetHelp: "Start a new anonymous session. Your previous data will be kept.",
    eyebrow: "Find your way through social insurance",
    title: "Your next step. At your pace.",
    introduction:
      "SV KI-Lotse guides you through benefits, applications and the responsible offices in Austria.",
    privacy: "You start with an anonymous session, without signing in.",
    boundary: "Please contact your treating healthcare professionals for medical questions.",
    footer: "SV KI-Lotse · Information and guidance",
  },
};
export type Language = keyof typeof shellCopy;
