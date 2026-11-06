import LotseOverlay
import LotseVoice
import SwiftUI

@MainActor
public struct CompanionPreferencesView: View {
    private let shell: MacShellController
    @AppStorage("pushToTalkShortcut") private var shortcut = PushToTalkShortcutChoice.controlShiftSpace.rawValue
    @AppStorage(VoiceConfiguration.speedPreferenceKey) private var speed = 1.0
    @AppStorage(WakeWordPreferences.enabledKey) private var wakeWord = true
    @AppStorage(OverlayPreferenceKey.cursorSize) private var cursorSize = CursorSize.standard.rawValue
    @AppStorage(OverlayPreferenceKey.cursorSpeed) private var cursorSpeed = CursorSpeed.standard.rawValue
    @AppStorage(OverlayPreferenceKey.reducedMotion) private var reducedMotion = false
    @AppStorage("analyticsOptedIn") private var analytics = false
    private var model: CompanionSettingsModel { shell.settings }
    private var dashboard: DashboardModel { shell.dashboard }
    private var copy: ChromeCopy { ChromeCopy(language: model.language) }

    public init(shell: MacShellController) { self.shell = shell }

    /// One size for every tab, so the Settings window never jumps when switching tabs.
    static let tabSize = CGSize(width: 640, height: 560)
    @State private var tab = SettingsTab(rawValue: UserDefaults.standard.string(forKey: "settingsTab") ?? "") ?? .general

    enum SettingsTab: String, CaseIterable { case general, voice, assistant, privacy, helpers, connections }

    public var body: some View {
        TabView(selection: $tab) {
            page(general).tabItem { Label(copy.general, systemImage: "gearshape") }.tag(SettingsTab.general)
            page(voice).tabItem { Label(copy.voice, systemImage: "waveform") }.tag(SettingsTab.voice)
            page(assistant).tabItem { Label(copy.assistant, systemImage: "cursorarrow.rays") }.tag(SettingsTab.assistant)
            page(privacy).tabItem { Label(copy.privacy, systemImage: "hand.raised") }.tag(SettingsTab.privacy)
            page(helpers).tabItem { Label(copy.helpers, systemImage: "person.2") }.tag(SettingsTab.helpers)
            page(connections).tabItem { Label(copy.connections, systemImage: "network") }.tag(SettingsTab.connections)
        }
        .tint(.lotseBrandText)
        .task {
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: CompanionConfiguration.dashboardRefreshInterval) } catch { return }
            }
        }
        .onChange(of: shortcut) { _, value in
            guard let choice = PushToTalkShortcutChoice(rawValue: value) else { return }
            shell.menu.selectShortcut(choice)
        }
        .onChange(of: speed) { _, value in shell.menu.speechSpeedChanged?(value) }
        .onChange(of: wakeWord) { _, value in shell.menu.setWakeWordEnabled(value) }
        .onChange(of: analytics) { _, value in shell.menu.analyticsConsentChanged?(value) }
        .onReceive(NotificationCenter.default.publisher(for: .selectSettingsTab)) { note in
            if let raw = note.object as? String, let selected = SettingsTab(rawValue: raw) { tab = selected }
        }
        .onDisappear { model.stopSample() }
    }

    private func page(_ content: some View) -> some View {
        content
            .formStyle(.grouped)
            .frame(width: Self.tabSize.width, height: Self.tabSize.height)
    }

    private func action(_ title: String, symbol: String, button: String, perform: @escaping () -> Void) -> some View {
        LabeledContent {
            Button(button, action: perform).accessibilityLabel(title)
        } label: {
            Label(title, systemImage: symbol)
        }
    }

    private var general: some View {
        Form {
            Section {
                LabeledContent(model.copy.appName,
                               value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                action(copy.dashboard, symbol: "macwindow", button: copy.open) { shell.workspace.showWorkspace() }
                action(copy.setup, symbol: "checklist", button: copy.check) { shell.runSetupChecks() }
                action(model.copy.updates.trimmingCharacters(in: CharacterSet(charactersIn: " …")),
                       symbol: "arrow.down.circle", button: copy.check) { shell.menu.checkForUpdates?() }
            }
            profileStatus
        }
    }

    private var voice: some View {
        @Bindable var settings = model
        return Form {
            Section {
                Picker(model.copy.languageTitle, selection: $settings.language) {
                    ForEach(CompanionLanguage.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                Toggle(isOn: $settings.voiceEnabled) {
                    Text(model.copy.enableVoice)
                    Text(model.copy.holdHint)
                }
                Toggle(isOn: $wakeWord) {
                    Text(WakeWordPreferences.title(german: model.language == .german))
                    Text(WakeWordPreferences.hint(german: model.language == .german))
                }
                Picker(model.copy.shortcut, selection: $shortcut) {
                    ForEach(PushToTalkShortcutChoice.allCases, id: \.rawValue) { Text($0.title).tag($0.rawValue) }
                }
                Picker(model.language == .german ? VoiceCopy.speedMenuTitle : VoiceCopy.speedMenuTitleEnglish, selection: $speed) {
                    ForEach(VoiceConfiguration.speedChoices, id: \.self) { Text(VoiceCopy.speedTitle($0)).tag($0) }
                }
            } footer: {
                Text(model.copy.dictationHint).foregroundStyle(.secondary)
            }
            Section {
                Picker(model.copy.voiceTitle, selection: $settings.voiceIdentifier) {
                    Text(model.copy.voiceDefault).tag("")
                    ForEach(model.voices, id: \.identifier) { Text($0.name).tag($0.identifier) }
                }
                LabeledContent(model.copy.voiceSample) {
                    Button(copy.play) { model.playSample() }.disabled(model.voices.isEmpty)
                }
            } footer: {
                Text(model.copy.voiceScope).foregroundStyle(.secondary)
            }
            Section { VoiceProviderStatusView(language: model.language) }
            profileStatus
        }
    }

    private var assistant: some View {
        Form {
            if let profile = dashboard.profile {
                Section {
                    Toggle(copy.simple, isOn: profileBinding(profile, \.simpleLanguage))
                    Picker(copy.register, selection: profileBinding(profile, \.register)) {
                        Text(copy.formal).tag("formal")
                        Text(copy.informal).tag("informal")
                    }
                    Picker(copy.detail, selection: profileBinding(profile, \.detailLevel)) {
                        Text(copy.brief).tag("brief")
                        Text(copy.standard).tag("standard")
                        Text(copy.detailed).tag("detailed")
                    }
                } footer: {
                    Text(copy.profileHint).foregroundStyle(.secondary)
                }
            }
            Section {
                action(model.copy.overlay, symbol: "cursorarrow", button: copy.run) { shell.menu.toggleOverlay?() }
                action(model.copy.circleToAsk, symbol: "lasso", button: copy.run) { shell.menu.circleToAsk?() }
                action(model.copy.cancelCircle, symbol: "xmark.circle", button: copy.run) { shell.menu.cancelCircle?() }
            }
            Section {
                Picker(OverlayCopy.sizeTitle, selection: $cursorSize) {
                    ForEach(CursorSize.allCases, id: \.rawValue) { Text(OverlayCopy.sizes[$0] ?? $0.rawValue).tag($0.rawValue) }
                }
                Picker(OverlayCopy.speedTitle, selection: $cursorSpeed) {
                    ForEach(CursorSpeed.allCases, id: \.rawValue) { Text(OverlayCopy.speeds[$0] ?? $0.rawValue).tag($0.rawValue) }
                }
                Toggle(OverlayCopy.reducedMotion, isOn: $reducedMotion)
            }
            profileStatus
        }
    }

    private var privacy: some View {
        Form {
            Section {
                Toggle(model.copy.analytics, isOn: $analytics)
            } footer: {
                Text(copy.privacyHint).foregroundStyle(.secondary)
            }
            Section {
                ForEach(CompanionPermission.allCases) { PermissionRow(model: model, permission: $0) }
                if model.settingsError { Text(model.copy.settingsFailed).foregroundStyle(.red) }
            } header: {
                Text(model.copy.permissions)
            } footer: {
                HStack {
                    Spacer()
                    Button(model.copy.recheck) { model.refreshPermissions() }
                }
            }
        }
    }

    private var helpers: some View {
        Form {
            Section {
                action(model.copy.relatives.trimmingCharacters(in: CharacterSet(charactersIn: " …")),
                       symbol: "person.2", button: copy.open) { shell.menu.openRelatives?() }
                action(copy.inviteHelper, symbol: "link", button: copy.open) {
                    shell.workspace.navigateToHelpers()
                    shell.workspace.showWorkspace()
                }
                action(copy.help, symbol: "questionmark.circle", button: copy.open) { shell.menu.showHelp?() }
            } footer: {
                Text(copy.helperHint).foregroundStyle(.secondary)
            }
        }
    }

    private var connections: some View {
        Form {
            Section {
                status(copy.workspace, connected: dashboard.workspaceReady)
                status(copy.database, connected: dashboard.health?.dependencies.database == "up")
                status(copy.storage, connected: dashboard.health?.dependencies.objectStorage == "up")
                LabeledContent {
                    Text(shell.workspace.configuration.url.host ?? "").foregroundStyle(.secondary)
                } label: {
                    Label(copy.address, systemImage: "link")
                }
            } footer: {
                HStack {
                    Spacer()
                    Button(model.copy.recheck) { Task { await refresh() } }
                }
            }
            profileStatus
        }
    }

    @ViewBuilder private var profileStatus: some View {
        if dashboard.profileFailed {
            Section {
                LabeledContent {
                    Button(copy.retry) {
                        if let profile = dashboard.profile { dashboard.updateProfile(profile)
                        } else { Task { await refresh() } }
                    }
                } label: {
                    Label(copy.failed, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                }
            }
        } else if dashboard.profile == nil {
            Section {
                LabeledContent {
                    ProgressView().controlSize(.small)
                } label: {
                    Label(copy.checking, systemImage: "person.crop.circle").foregroundStyle(.secondary)
                }
            }
        }
    }

    private func status(_ title: String, connected: Bool) -> some View {
        LabeledContent {
            Text(connected ? copy.connected : copy.unavailable).foregroundStyle(.secondary)
        } label: {
            Label {
                Text(title)
            } icon: {
                Image(systemName: connected ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .foregroundStyle(connected ? Color.lotseBrandText : Color.secondary)
            }
        }
    }

    private func profileBinding<Value>(_ fallback: BrainProfile, _ keyPath: WritableKeyPath<BrainProfile, Value>) -> Binding<Value> {
        Binding(get: { (dashboard.profile ?? fallback)[keyPath: keyPath] }, set: { value in
            var updated = dashboard.profile ?? fallback
            updated[keyPath: keyPath] = value
            dashboard.updateProfile(updated)
        })
    }

    private func refresh() async {
        model.refreshPermissions()
        await dashboard.refreshServices()
        if let profile = dashboard.profile {
            let language: CompanionLanguage = profile.language == "en" ? .english : .german
            if model.language != language { model.language = language }
        }
    }
}
