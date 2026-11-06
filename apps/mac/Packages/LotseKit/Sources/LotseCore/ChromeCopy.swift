import Foundation

struct ChromeCopy {
    var language: CompanionLanguage = .german
    func text(_ german: String, _ english: String) -> String { language == .german ? german : english }
    var dashboard: String { text("Dashboard öffnen", "Open dashboard") }
    var open: String { text("Öffnen", "Open") }
    var check: String { text("Prüfen", "Check") }
    var run: String { text("Ausführen", "Run") }
    var play: String { text("Abspielen", "Play") }
    var address: String { text("Adresse", "Address") }
    var newChat: String { text("Neuer Chat", "New chat") }
    var search: String { text("Chats suchen", "Search chats") }
    var settings: String { text("Einstellungen…", "Settings…") }
    var setup: String { text("Einrichtung prüfen", "Check setup") }
    var feedback: String { text("Feedback geben", "Give feedback") }
    var about: String { text("Über SV KI-Lotse", "About SV KI-Lotse") }
    var help: String { text("Hilfe", "Help") }
    var inviteHelper: String { text("Hilfsperson einladen", "Invite a helper") }
    var pause: String { text("Zuhören pausieren", "Pause listening") }
    var resume: String { text("Zuhören fortsetzen", "Resume listening") }
    var restart: String { text("Neu starten", "Restart") }
    var quit: String { text("SV KI-Lotse beenden", "Quit SV KI-Lotse") }
    var running: String { text("SV KI-Lotse läuft", "SV KI-Lotse is running") }
    var paused: String { text("SV KI-Lotse pausiert", "SV KI-Lotse is paused") }
    var disconnected: String { text("SV KI-Lotse nicht verbunden", "SV KI-Lotse is disconnected") }
    var profile: String { text("Profil & Einstellungen", "Profile & settings") }
    var untitled: String { text("Neuer Chat", "New chat") }
    var today: String { text("Heute", "Today") }
    var yesterday: String { text("Gestern", "Yesterday") }
    var week: String { text("Letzte 7 Tage", "Last 7 days") }
    var older: String { text("Älter", "Older") }
    var rename: String { text("Umbenennen", "Rename") }
    var delete: String { text("Chat löschen", "Delete chat") }
    var deleteHint: String { text("Gespräch, Nachrichten und vorbereitete Formulare werden gelöscht. "
             + "Gemeinsam genutzte Dokumente bleiben erhalten.",
                                  "The conversation, messages and prepared forms will be deleted. Shared documents are retained.") }
    var cancel: String { text("Abbrechen", "Cancel") }
    var save: String { text("Speichern", "Save") }
    var title: String { text("Titel", "Title") }
    var empty: String { text("Keine Chats gefunden", "No chats found") }
    var failed: String { text("Änderung oder Laden fehlgeschlagen. Bitte erneut versuchen.", "Could not load or save. Please try again.") }
    var retry: String { text("Erneut versuchen", "Try again") }
    var general: String { text("Allgemein", "General") }
    var voice: String { text("Sprache & Stimme", "Language & voice") }
    var assistant: String { text("Assistent", "Assistant") }
    var privacy: String { text("Datenschutz", "Privacy") }
    var helpers: String { text("Helfer", "Helpers") }
    var connections: String { text("Verbindungen", "Connections") }
    var simple: String { text("Einfache Sprache", "Simple language") }
    var register: String { text("Anrede", "Address") }
    var formal: String { text("Sie", "Formal") }
    var informal: String { text("Du", "Informal") }
    var detail: String { text("Antwortlänge", "Response length") }
    var brief: String { text("Kurz", "Brief") }
    var standard: String { text("Standard", "Standard") }
    var detailed: String { text("Ausführlich", "Detailed") }
    var connected: String { text("Verbunden", "Connected") }
    var unavailable: String { text("Nicht verfügbar", "Unavailable") }
    var checking: String { text("Wird geprüft…", "Checking…") }
    var database: String { text("Datenbank", "Database") }
    var storage: String { text("Dokumentspeicher", "Document storage") }
    var workspace: String { text("Arbeitsbereich", "Workspace") }
    var profileHint: String { text("Sprache und Antwortstil werden im gemeinsamen Profil gespeichert.",
                                   "Language and response style are saved to your shared profile.") }
    var privacyHint: String { text("Bildschirmaufnahme nur auf Anfrage. Spracheingabe nur bei gedrückter Sprechtaste. "
             + "Keine Aufnahme beim Start.",
                                   "Screen capture only on request. Voice input only while holding push-to-talk. No recording at launch.") }
    var helperHint: String { text("Bildschirm und Mikrofon werden erst nach Ihrer Freigabe geteilt. "
             + "Sie können die Freigabe jederzeit beenden.",
                                  "Screen and microphone sharing require your consent. You can stop sharing at any time.") }
    var feedbackHint: String { text("Feedback und Fehler können Sie im Projekt melden. Bitte keine persönlichen Gesundheitsdaten angeben.",
                                    "Report feedback and issues in the project. Please leave out personal health information.") }
}
