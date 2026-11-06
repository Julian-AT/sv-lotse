// Menu-bar lifecycle adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import LotseCore
import Sparkle
import SwiftUI

/// Regular Dock app with a menu-bar status item, like other desktop assistants.
@main
struct SVKILotseApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings { SettingsRoot(delegate: appDelegate) }
            .commands { LotseCommands(delegate: appDelegate) }
    }
}

/// Main menu additions; App, Bearbeiten and Fenster keep the standard system items (localized via CFBundleLocalizations).
private struct LotseCommands: Commands {
    let delegate: CompanionAppDelegate

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Nach Updates suchen …") { delegate.shell?.menu.checkForUpdates?() }
        }
        CommandGroup(replacing: .newItem) {
            Button("Neuer Chat") { delegate.shell?.menu.newChat?() }
                .keyboardShortcut("n")
        }
        ToolbarCommands()
        CommandGroup(before: .windowArrangement) {
            Button("Dashboard") { delegate.shell?.showDashboard() }
                .keyboardShortcut("0")
            Divider()
        }
        CommandGroup(replacing: .help) {
            Button("SV KI-Lotse-Hilfe") { delegate.shell?.menu.showHelp?() }
                .keyboardShortcut("?")
        }
    }
}

/// Observes the delegate so the Settings scene never renders an empty, zero-sized window before the shell exists.
private struct SettingsRoot: View {
    @ObservedObject var delegate: CompanionAppDelegate

    var body: some View {
        if let shell = delegate.shell {
            CompanionPreferencesView(shell: shell)
        } else {
            ProgressView().frame(width: 720, height: 520)
        }
    }
}

@MainActor
final class CompanionAppDelegate: NSObject, NSApplicationDelegate, ObservableObject {
    @Published private(set) var shell: MacShellController?
    private var updater: SPUStandardUpdaterController?

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        // The Dock caches icons per bundle path, so a rebuilt Debug app can keep a stale generic tile.
        // Set the tile from the bundled AppIcon (asset catalog, all sizes 16 to 1024) on every launch.
        if let icon = Bundle.main.image(forResource: "AppIcon") {
            NSApp.applicationIconImage = icon
        }
    }

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

    /// Dock icon click: bring back the dashboard (or the unfinished setup) when it was closed.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        shell?.showMainWindow()
        return true
    }

    /// Closing the dashboard keeps the companion running in the Dock and the menu bar.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

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
