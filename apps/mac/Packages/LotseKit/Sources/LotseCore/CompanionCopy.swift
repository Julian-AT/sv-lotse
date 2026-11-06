import Foundation

struct CompanionCopy {
    var relatives: String { text("Angehörige: Bildschirm teilen …", "Relatives: share screen …") }
    var relativesActive: String { text("Bildschirm und Mikrofon werden geteilt – stoppen …", "Screen and microphone shared – stop …") }
    var language: CompanionLanguage = .german
    private func text(_ german: String, _ english: String) -> String { language == .german ? german : english }

    var appName: String { "SV KI-Lotse" }
    var welcome: String { text("Willkommen beim SV KI-Lotsen", "Welcome to SV KI-Lotse") }
    var settings: String { text("Einstellungen …", "Settings …") }
    var settingsTitle: String { text("Einstellungen", "Settings") }
    var introduction: String {
        text("Wählen Sie Sprache und Stimme. Aktivieren Sie danach nur die Funktionen, die Sie nutzen möchten.",
             "Choose your language and voice. Then enable only the features you want to use.")
    }
    var permissions: String { text("Berechtigungen", "Permissions") }
    var permissionHint: String {
        text("Zugriff wird erst nach Ihrem Klick angefragt. Sie können jederzeit im Arbeitsbereich tippen. "
             + "Nach einer Änderung in den Systemeinstellungen hier erneut prüfen; macOS kann einen Neustart der App verlangen.",
             "Access is requested only after you click. You can always type in the workspace. "
             + "Recheck here after changing System Settings; macOS may require restarting the app.")
    }
    var languageTitle: String { text("Sprache", "Language") }
    var voiceTitle: String { text("Stimme auf diesem Mac", "Voice on this Mac") }
    var voiceDefault: String { text("Systemstimme", "System voice") }
    var voiceSample: String { text("Stimme anhören", "Play voice sample") }
    var sample: String { text("Guten Tag. Ich begleite Sie durch den Arbeitsbereich.", "Hello. I will guide you through the workspace.") }
    var voiceUnavailable: String { text("Auf diesem Mac ist für diese Sprache keine Stimme installiert.",
                                        "No voice for this language is installed on this Mac.") }
    var voiceScope: String {
        text("Die Auswahl gilt für die lokale Hörprobe. Die Antwortstimme wählen Sie im Arbeitsbereich.",
             "This selection controls the local preview. Choose the response voice in the workspace.")
    }
    var allow: String { text("Aktivieren", "Enable") }
    var systemSettings: String { text("Systemeinstellungen", "System Settings") }
    var recheck: String { text("Erneut prüfen", "Check again") }
    var openWorkspace: String { text("Arbeitsbereich öffnen", "Open workspace") }
    var overlay: String { text("Begleitzeiger ein-/ausblenden", "Show/hide companion pointer") }
    var circleToAsk: String { text("Bereich einkreisen und fragen", "Circle a region to ask") }
    var cancelCircle: String { text("Zeichenmodus beenden", "Cancel circle selection") }
    var circleInstruction: String {
        text("Bereich einkreisen, loslassen und mit der Sprechtaste fragen. Abbrechen: Esc oder Rechtsklick.",
             "Circle a region, release, then ask with push-to-talk. Cancel: Escape or right-click.")
    }
    var circleReady: String { text("Bereich ausgewählt. Jetzt mit der Sprechtaste fragen.", "Region selected. Ask with push-to-talk.") }
    var captureUnavailable: String {
        text("Bildschirmkontext nicht verfügbar. Die Frage wird ohne Bildschirm gesendet. Bildschirmaufnahme in Einstellungen prüfen.",
             "Screen context unavailable. Sending the question without a screenshot. Check Screen Recording in Settings.")
    }
    var updates: String { text("Nach Updates suchen …", "Check for updates …") }
    var analytics: String { text("Nutzungsstatistik erlauben", "Allow usage analytics") }
    var quit: String { text("Beenden", "Quit") }
    var shortcut: String { text("Sprechtaste auswählen", "Choose push-to-talk key") }
    var holdHint: String { text("⌥⌘ gedrückt halten zum Sprechen, loslassen zum Senden.", "Hold ⌥⌘ to speak, release to send.") }
    var shortcutRunning: String { text("Sprechtaste aktiv: ⌥⌘ gedrückt halten", "Push-to-talk active: hold ⌥⌘") }
    var shortcutWaiting: String { text("Sprechtaste wartet auf Eingabeüberwachung", "Push-to-talk waits for Input Monitoring") }
    var shortcutOff: String { text("Sprechtaste ausgeschaltet", "Push-to-talk off") }
    func shortcutFailed(_ reason: String) -> String {
        text("Sprechtaste konnte nicht starten (\(reason)). Eingabeüberwachung prüfen.",
             "Push-to-talk could not start (\(reason)). Check Input Monitoring.")
    }
    var shortcutStatusTitle: String { text("Status der Sprechtaste", "Push-to-talk status") }
    var microphoneUnavailable: String { text("Mikrofon nicht verfügbar", "Microphone unavailable") }
    var speechServiceUnavailable: String { text("Sprachdienst nicht erreichbar", "Speech service unreachable") }
    var dictationHint: String {
        text("Diktieren: ⌃⇧D halten, zum Einfügen ins aktive Textfeld loslassen.",
             "Dictation: hold ⌃⇧D, release to insert into the focused text field.")
    }
    var dictationError: String { text("Diktat konnte nicht eingefügt werden.", "Dictation could not be inserted.") }
    var dictationErrorHint: String {
        text("Aktivieren Sie Bedienungshilfen, Mikrofon und Spracherkennung in den Einstellungen. "
             + "Klicken Sie in ein bearbeitbares Textfeld und lassen Sie den Fokus dort bis zum Einfügen. "
             + "Passwortfelder sind ausgeschlossen. Das Diktat wird nicht an das Gespräch gesendet.",
             "Enable Accessibility, Microphone and Speech Recognition in settings. "
             + "Click an editable text field and keep it focused until insertion finishes. "
             + "Password fields are excluded. Dictation is never sent to the conversation.")
    }
    var enableVoice: String { text("Sprechtaste aktivieren", "Enable push-to-talk") }
    var disableVoice: String { text("Sprechtaste deaktivieren", "Disable push-to-talk") }
    var ready: String { text("Arbeitsbereich verbunden", "Workspace connected") }
    var connecting: String { text("Arbeitsbereich wird verbunden", "Connecting workspace") }
    var disconnected: String { ChromeCopy(language: language).disconnected }
    var listening: String { text("Sprachaufnahme läuft", "Recording voice") }
    var voiceOff: String { text("Sprechtaste ausgeschaltet", "Push-to-talk off") }
    var voiceReady: String { text("Sprechtaste bereit", "Push-to-talk ready") }
    var voiceNeedsPermission: String { text("Sprechtaste: Berechtigung fehlt", "Push-to-talk: permission needed") }
    var caseContext: String { text("Fall und Person: im Arbeitsbereich", "Case and subject: in workspace") }
    var autonomyContext: String { text("Autonomiestufe: im Arbeitsbereich festgelegt", "Autonomy level: set in workspace") }
    var settingsFailed: String { text("Systemeinstellungen konnten nicht geöffnet werden. Öffnen Sie Datenschutz & Sicherheit manuell.",
                                      "Could not open System Settings. Open Privacy & Security manually.") }
    var voiceError: String { text("Spracheingabe ist derzeit nicht verfügbar.", "Voice input is currently unavailable.") }
    var voiceErrorHint: String {
        text("Prüfen Sie Mikrofon, Eingabeüberwachung und die installierte Spracherkennung. Sie können im Arbeitsbereich tippen.",
             "Check microphone, Input Monitoring and installed speech recognition. You can type in the workspace.")
    }
    var analyticsError: String { text("Nutzungsstatistik ist nicht verfügbar.", "Usage analytics is unavailable.") }
    var analyticsErrorHint: String {
        text("Bitte prüfen Sie die konfigurierte Statistik-Adresse.", "Check the configured analytics address.")
    }

    func title(for permission: CompanionPermission) -> String {
        switch permission {
        case .microphone: text("Mikrofon", "Microphone")
        case .screenRecording: text("Bildschirmaufnahme", "Screen Recording")
        case .accessibility: text("Bedienungshilfen", "Accessibility")
        case .inputMonitoring: text("Eingabeüberwachung", "Input Monitoring")
        case .speechRecognition: text("Spracherkennung", "Speech Recognition")
        case .notifications: text("Mitteilungen", "Notifications")
        case .calendar: text("Kalender", "Calendar")
        }
    }

    func reason(for permission: CompanionPermission) -> String {
        switch permission {
        case .microphone: text("Nimmt Ihre Stimme auf, während Sie die Sprech- oder Diktiertaste halten.",
                               "Records your voice while you hold the push-to-talk or dictation key.")
        case .screenRecording: text("Liest den Bildschirm nur auf Ihre ausdrückliche Anfrage.",
                                    "Reads the screen only when you explicitly request it.")
        case .accessibility: text("Findet Bedienelemente für die Bildschirmbegleitung und fügt Ihr Diktat ins aktive Textfeld ein.",
                                  "Finds controls for on-screen guidance and inserts your dictation into the focused text field.")
        case .inputMonitoring: text("Erkennt Sprech- und Diktiertaste auch dann, wenn eine andere App im Vordergrund ist.",
                                    "Recognizes push-to-talk and dictation keys while another app is in front.")
        case .speechRecognition: text("Wandelt Ihre Stimme mit der Apple-Spracherkennung auf diesem Mac in Text um.",
                                      "Converts your voice to text using Apple speech recognition on this Mac.")
        case .notifications: text("Zeigt Hinweise zu abgeschlossenen Aufgaben, wenn der Arbeitsbereich im Hintergrund ist.",
                                  "Shows completed-task notices while the workspace is in the background.")
        case .calendar: text("Trägt geprüfte Termine und Fristen nach Ihrer Freigabe in Ihren Kalender ein.",
                             "Adds reviewed appointments and deadlines to your calendar after you approve them.")
        }
    }

    func status(_ status: CompanionPermissionStatus) -> String {
        switch status {
        case .granted: text("Erlaubt", "Allowed")
        case .notDetermined: text("Noch nicht angefragt", "Not requested yet")
        case .notGranted: text("Nicht freigegeben", "Not enabled")
        case .denied: text("Abgelehnt – in Systemeinstellungen ändern", "Denied – change in System Settings")
        case .restricted: text("Durch Systemrichtlinie eingeschränkt", "Restricted by system policy")
        }
    }
}
