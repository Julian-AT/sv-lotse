import Foundation

struct GuidedSetupCopy {
    let language: CompanionLanguage
    private var companion: CompanionCopy { CompanionCopy(language: language) }
    private func text(_ german: String, _ english: String) -> String { language == .german ? german : english }

    var title: String { text("Ihr Lotse. Startklar in wenigen Schritten.", "Your guide. Ready in a few steps.") }
    var subtitle: String {
        text("Sie bestimmen, was der Lotse auf diesem Mac darf.", "You control what your guide can access on this Mac.")
    }
    var setup: String { text("Einrichtung prüfen …", "Run guided setup …") }
    var next: String { text("Weiter", "Continue") }
    var openSystemSettings: String { text("In Systemeinstellungen öffnen", "Open in System Settings") }
    var requestingAll: String {
        text("Der Lotse fragt jetzt nacheinander alle Berechtigungen an. Bitte bestätigen Sie jede Abfrage.",
             "Your guide is now requesting each permission in turn. Please answer every prompt.")
    }
    var toggleHint: String {
        text("Schalten Sie SV KI-Lotse in den geöffneten Systemeinstellungen ein. Wir prüfen alle 2 Sekunden erneut.",
             "Turn on SV KI-Lotse in the System Settings pane that just opened. We recheck every 2 seconds.")
    }
    var restart: String { text("SV KI-Lotse neu starten", "Restart SV KI-Lotse") }
    var restartHint: String {
        text("macOS wendet die Bildschirmaufnahme erst nach einem Neustart der App an.",
             "macOS applies screen recording only after the app restarts.")
    }
    var fix: String { text("Beheben", "Fix") }
    var finish: String { text("Einrichtung abschließen", "Finish setup") }
    var later: String { text("Vorerst im Arbeitsbereich tippen", "Type in the workspace for now") }
    var autoCheck: String {
        text("Wir prüfen automatisch erneut. macOS kann nach einer Freigabe einen Neustart der App verlangen.",
             "We recheck automatically. macOS may require restarting the app after granting access.")
    }
    var optional: String {
        text("Sie können ohne Freigabe weitergehen. Die Einrichtung bleibt offen; der Arbeitsbereich funktioniert auch mit Texteingabe.",
             "You can continue without granting access. Setup stays incomplete; you can still type in the workspace.")
    }
    var connectionHint: String {
        text("Prüfen Sie die Internetverbindung und ob der konfigurierte Arbeitsbereich läuft. Erneut prüfen lädt ihn bei Bedarf neu.",
             "Check your internet connection and that the configured workspace is running. Checking again reloads it when needed.")
    }
    func progress(_ count: Int) -> String {
        text("\(count) von \(GuidedSetupStep.allCases.count) geprüft", "\(count) of \(GuidedSetupStep.allCases.count) verified")
    }
    func title(for step: GuidedSetupStep) -> String {
        if let permission = step.permission { return companion.title(for: permission) }
        switch step {
        case .workspaceURL: return text("Arbeitsbereich erreichbar", "Workspace reachable")
        case .session: return text("Sitzung verbunden", "Session connected")
        case .bridge: return text("Mac mit Arbeitsbereich verbinden", "Connect Mac to workspace")
        case .voiceProvider: return text("Sprachdienst prüfen", "Check voice service")
        default: return companion.permissions
        }
    }
    func reason(for step: GuidedSetupStep) -> String {
        if let permission = step.permission { return companion.reason(for: permission) }
        switch step {
        case .workspaceURL: return text("Öffnet Ihren konfigurierten Arbeitsbereich und prüft dessen Antwort.",
                                       "Opens your configured workspace and checks its response.")
        case .session: return text("Erstellt bei Bedarf Ihre Sitzung und prüft das geschützte Sitzungscookie im Arbeitsbereich.",
                                  "Creates your session when needed and checks the protected session cookie in the workspace.")
        case .bridge: return text("Prüft, ob der Arbeitsbereich die Begrüßung dieses Macs bestätigt hat.",
                                 "Checks that the workspace has acknowledged this Mac’s hello.")
        case .voiceProvider: return text("Prüft ElevenLabs für Spracheingabe und Antworten. "
                                        + "Bei Ausfall verwenden wir die verfügbare Apple-Stimme und lokale Spracherkennung.",
                                        "Checks ElevenLabs for voice input and responses. "
                                        + "If unavailable, we use the available Apple voice and on-device speech recognition.")
        default: return ""
        }
    }
    func status(_ status: GuidedSetupStatus) -> String {
        switch status {
        case .pending: text("Noch nicht geprüft", "Not checked yet")
        case .checking: text("Wird geprüft …", "Checking …")
        case .missing: text("Fehlt", "Missing")
        case .verified: text("Geprüft", "Verified")
        case .appleFallback: text("Geprüft – Apple-Ersatz verfügbar", "Verified – Apple fallback available")
        }
    }
    // swiftlint:disable:next cyclomatic_complexity
    func symbol(for step: GuidedSetupStep) -> String {
        switch step {
        case .microphone: "mic"
        case .speechRecognition: "waveform"
        case .screenRecording: "rectangle.inset.filled"
        case .accessibility: "accessibility"
        case .inputMonitoring: "keyboard"
        case .notifications: "bell"
        case .calendar: "calendar"
        case .workspaceURL: "network"
        case .session: "lock.shield"
        case .bridge: "link"
        case .voiceProvider: "speaker.wave.2"
        }
    }
}
