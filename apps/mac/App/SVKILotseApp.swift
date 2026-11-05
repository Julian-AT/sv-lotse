// Menu-bar lifecycle adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import LotseCore
import Sparkle
import SwiftUI

@main
struct SVKILotseApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
final class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    private var shell: MacShellController?
    private var updater: SPUStandardUpdaterController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let shell = try MacShellController()
            self.shell = shell
            shell.menu.checkForUpdates = { [weak self] in self?.checkForUpdates() }
            shell.start()
        } catch {
            let alert = NSAlert()
            alert.messageText = "Der Arbeitsbereich kann nicht geöffnet werden."
            alert.informativeText = "Bitte prüfen Sie die Einstellung LOTSE_WORKSPACE_URL."
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) { shell?.stop() }

    private func checkForUpdates() {
        guard Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") is String,
            Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") is String
        else {
            let alert = NSAlert()
            alert.messageText = "Updates sind für diesen Build nicht eingerichtet."
            alert.informativeText = "Signierte Veröffentlichungen enthalten die Adresse und den Prüfschlüssel für Updates."
            alert.runModal()
            return
        }
        if updater == nil {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        }
        updater?.checkForUpdates(nil)
    }
}
