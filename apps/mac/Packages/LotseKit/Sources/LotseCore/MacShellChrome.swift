import AppKit
import LotseBridge
import LotseVoice
import SwiftUI

extension MacShellController {
    var voiceEnabled: Bool { settings.voiceEnabled }
    var copy: CompanionCopy { settings.copy }
    var scribeTranscriptionProvider: ScribeRealtimeTranscriptionProvider {
        ScribeRealtimeTranscriptionProvider(loadToken: tokenLoader, language: { [weak self] in
            self?.settings.language.providerLanguage ?? CompanionLanguage.german.providerLanguage
        })
    }

    var tokenLoader: VoiceTokenLoader {
        { [weak self] kind, language in
            guard let self else { throw VoiceServiceError.unavailable }
            let data = try await workspace.requestVoiceToken(type: kind.rawValue, language: language)
            return try JSONDecoder().decode(VoiceToken.self, from: data)
        }
    }

    func configureDashboard() {
        guard let window = workspace.window else { return }
        // Native unified toolbar: the split view's sidebar gets the system (Liquid Glass) sidebar material on
        // macOS 26; the transparent chat page shows the window background, so chat, toolbar and window match.
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .hidden
        window.toolbarStyle = .unified
        window.isOpaque = true
        window.backgroundColor = .windowBackgroundColor
        window.minSize = NSSize(width: 820, height: 600)
        let host = NSHostingView(rootView: DashboardView(model: dashboard, settings: settings) { [weak self] in
            self?.menu.openImport?()
        })
        host.sceneBridgingOptions = [.toolbars, .title]
        window.contentView = host
        workspace.webView.underPageBackgroundColor = .clear
        workspace.onStateChanged = { [weak self] in
            guard let self else { return }
            dashboard.workspaceReady = workspace.isReady
            refreshMenuStatus()
            if workspace.isReady {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    await dashboard.refresh()
                    await dashboard.refreshServices()
                    if let profile = dashboard.profile {
                        let language: CompanionLanguage = profile.language == "en" ? .english : .german
                        if settings.language != language { settings.language = language }
                    }
                    speech.prepareAcknowledgements(language: settings.language.providerLanguage)
                    refreshMenuStatus()
                }
            }
        }
    }

    /// Dock click, Spotlight or Finder launch: guided setup while it is incomplete, otherwise the dashboard.
    /// Overlay panels are always on screen, so this checks the two main windows instead of `hasVisibleWindows`.
    public func showMainWindow() {
        for window in [setupWindow.window, workspace.window] where window?.isVisible == true {
            window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        setupWindow.start()
    }

    public func showDashboard() { workspace.showWorkspace() }

    public func runSetupChecks() {
        settings.refreshPermissions()
        presentSettings(tab: "privacy")
    }

    /// Debug builds: `-LotseDebugOpen dashboard,settings,companion` opens windows at launch for UI captures.
    func openDebugWindows() {
        #if DEBUG
        guard let targets = UserDefaults.standard.string(forKey: "LotseDebugOpen")?.split(separator: ",") else { return }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self else { return }
            if targets.contains("dashboard") { workspace.showWorkspace() }
            if targets.contains("companion") { settingsWindow.showSettings() }
            if targets.contains("settings") { presentSettings() }
        }
        #endif
    }

    func presentSettings(tab: String? = nil) {
        NotificationCenter.default.post(name: .openCompanionSettings, object: tab)
    }

    func restartApplication() {
        let url = Bundle.main.bundleURL
        guard url.pathExtension == "app" else { workspace.load(); return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, error in
            guard error == nil else { return }
            Task { @MainActor in NSApp.terminate(nil) }
        }
    }

    func configureChromeMenu() {
        menu.refreshStatus = { [weak self] in
            guard let self else { return }
            settings.refreshPermissions()
            Task {
                await dashboard.refreshServices()
                refreshMenuStatus()
            }
        }

        menu.newChat = { [weak self] in
            guard let self else { return }
            workspace.showWorkspace()
            Task { await dashboard.create() }
        }
        menu.checkSetup = { [weak self] in self?.runSetupChecks() }
        menu.giveFeedback = {
            guard let url = URL(string: CompanionConfiguration.feedbackURL) else { return }
            NSWorkspace.shared.open(url)
        }
        // There is no website anymore: help opens the in-app setup assistant.
        menu.showHelp = { [weak self] in self?.runSetupChecks() }
        menu.restartApp = { [weak self] in self?.restartApplication() }
    }

    func synchronizeProfileLanguage() { dashboard.setLanguage(settings.language) }
}
