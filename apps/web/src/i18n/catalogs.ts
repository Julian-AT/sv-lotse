import type { Locale } from "./config.ts";

const de = {
  "shell.skip": "Zum Inhalt",
  "shell.navigation": "Sprache",
  "shell.settings": "Einstellungen",
  "shell.reset": "Neue Sitzung",
  "shell.resetting": "Sitzung wird erneuert …",
  "shell.resetDone": "Neue Sitzung gestartet.",
  "shell.resetError": "Die Sitzung konnte nicht erneuert werden. Bitte versuchen Sie es erneut.",
  "shell.resetHelp":
    "Starten Sie mit einer neuen, anonymen Sitzung. Bisherige Daten werden dabei nicht gelöscht.",
  "shell.eyebrow": "Orientierung im Sozialversicherungssystem",
  "shell.title": "Ihr nächster Schritt. In Ihrem Tempo.",
  "shell.introduction":
    "Der SV KI-Lotse begleitet Sie bei Fragen zu Leistungen, Anträgen und zuständigen Stellen in Österreich.",
  "shell.privacy": "Sie starten ohne Anmeldung mit einer anonymen Sitzung.",
  "shell.boundary":
    "Für medizinische Fragen wenden Sie sich bitte an Ihre behandelnden Ärztinnen und Ärzte.",
  "shell.footer": "SV KI-Lotse · Orientierung und Begleitung",
} as const;

export type MessageKey = keyof typeof de;
export type Catalog = Readonly<Record<MessageKey, string>>;

const en = {
  "shell.skip": "Skip to content",
  "shell.navigation": "Language",
  "shell.settings": "Settings",
  "shell.reset": "New session",
  "shell.resetting": "Starting a new session …",
  "shell.resetDone": "New session started.",
  "shell.resetError": "The session could not be renewed. Please try again.",
  "shell.resetHelp": "Start a new anonymous session. Your previous data will be kept.",
  "shell.eyebrow": "Find your way through social insurance",
  "shell.title": "Your next step. At your pace.",
  "shell.introduction":
    "SV KI-Lotse guides you through benefits, applications and the responsible offices in Austria.",
  "shell.privacy": "You start with an anonymous session, without signing in.",
  "shell.boundary": "Please contact your treating healthcare professionals for medical questions.",
  "shell.footer": "SV KI-Lotse · Information and guidance",
} satisfies Catalog;

const deSimple = {
  "shell.skip": "Zum Inhalt",
  "shell.navigation": "Sprache",
  "shell.settings": "Einstellungen",
  "shell.reset": "Neue Sitzung",
  "shell.resetting": "Eine neue Sitzung startet …",
  "shell.resetDone": "Die neue Sitzung ist gestartet.",
  "shell.resetError": "Die neue Sitzung konnte nicht starten. Bitte versuchen Sie es noch einmal.",
  "shell.resetHelp":
    "Starten Sie eine neue Sitzung ohne Anmeldung. Ihre bisherigen Daten bleiben gespeichert.",
  "shell.eyebrow": "Hilfe bei Fragen zur Sozialversicherung",
  "shell.title": "Ihr nächster Schritt. Sie bestimmen das Tempo.",
  "shell.introduction":
    "Der SV KI-Lotse hilft Ihnen bei Fragen zur Sozialversicherung in Österreich. Sie erfahren, welche Hilfe es gibt. Sie erfahren auch, wo und wie Sie einen Antrag stellen können.",
  "shell.privacy": "Sie brauchen sich nicht anzumelden. Ihre Sitzung ist anonym.",
  "shell.boundary":
    "Bei medizinischen Fragen wenden Sie sich bitte an Ihre Ärztin oder Ihren Arzt.",
  "shell.footer": "SV KI-Lotse · Informationen und Hilfe",
} satisfies Catalog;

export const catalogs: Readonly<Record<Locale, Catalog>> = { de, en, "de-simple": deSimple };
