import AppKit

@MainActor
func showCompanionAlert(message: String, hint: String) {
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = hint
    alert.runModal()
}
