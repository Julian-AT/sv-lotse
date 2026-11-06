public struct RelativesCopy: Sendable {
    public var english = false
    public init(english: Bool = false) { self.english = english }
    public var title: String { text("Angehörige: Bildschirm und Sprache teilen", "Relatives: share screen and voice") }
    public var helper: String { text("Hilfe", "Helper") }
    var caseTitle: String { text("Fall", "Case") }
    var displayTitle: String { text("Bildschirm", "Display") }
    var consent: String {
        text("Ich stimme zu, diesen Bildschirm und mein Mikrofon für 15 Minuten mit den eingeladenen Helfenden zu teilen.",
             "I agree to share this display and my microphone with invited helpers for 15 minutes.")
    }
    var explanation: String {
        text("Helfende können sprechen, zeigen und zeichnen. Freigaben bleiben bei Ihnen. " +
             "Keine Sitzungsaufzeichnung. Sie können jederzeit stoppen.",
             "Helpers can speak, point and draw. Approvals stay with you. No session recording. You can stop at any time.")
    }
    var scope: String {
        text("Geteilt wird der gewählte Bildschirm. Der Lotse und konfigurierte sensible Apps werden ausgeblendet.",
             "The selected display is shared. Lotse and configured sensitive apps are excluded.")
    }
    var start: String { text("Bildschirm und Mikrofon freigeben", "Share screen and microphone") }
    var stop: String { text("Teilen sofort stoppen", "Stop sharing now") }
    var active: String { text("Bildschirm und Mikrofon werden geteilt", "Screen and microphone are being shared") }
    var connecting: String { text("Verbindung wird hergestellt …", "Connecting …") }
    var stopping: String { text("Teilen wird beendet …", "Stopping sharing …") }
    var inactive: String { text("Bildschirm und Mikrofon sind nicht freigegeben", "Screen and microphone are not shared") }
    var failure: String {
        text("Teilen ist nicht verfügbar. Prüfen Sie die Berechtigungen, die Verbindung und den ausgewählten Fall.",
             "Sharing is unavailable. Check permissions, the connection and the selected case.")
    }
    var reload: String { text("Fälle neu laden", "Reload cases") }
    var noCases: String {
        text("Öffnen oder erstellen Sie zuerst einen Fall im Arbeitsbereich.", "Open or create a case in the workspace first.")
    }
    private func text(_ german: String, _ english: String) -> String { self.english ? english : german }
}
