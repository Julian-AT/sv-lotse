import AppKit
import Foundation
import Observation
import os

@MainActor @Observable
final class GuidedSetupModel {
    private(set) var state = GuidedSetupState()
    private(set) var completed: Bool
    /// True while the automatic permission sequence runs.
    private(set) var requestingAll = false
    /// Screen recording only takes effect after a relaunch once it was requested.
    private(set) var restartSuggested = false
    let settings: CompanionSettingsModel
    @ObservationIgnored private let preferences: UserDefaults
    @ObservationIgnored private let connection: GuidedSetupConnectionAccess
    @ObservationIgnored private var monitor: Task<Void, Never>?
    @ObservationIgnored private var checking = false
    @ObservationIgnored private var lastProbe: ContinuousClock.Instant?
    @ObservationIgnored private var connectionID: UUID?
    @ObservationIgnored private var voiceLanguage: CompanionLanguage?
    @ObservationIgnored private var permissionSequence: Task<Void, Never>?
    @ObservationIgnored private let log = Logger(subsystem: "dev.svkilotse.mac", category: "setup")

    init(settings: CompanionSettingsModel, connection: GuidedSetupConnectionAccess, preferences: UserDefaults = .standard) {
        self.settings = settings
        self.connection = connection
        self.preferences = preferences
        completed = preferences.bool(forKey: CompanionConfiguration.setupCompletedKey)
    }

    func start() {
        stop()
        state = GuidedSetupState()
        lastProbe = nil
        connectionID = nil
        voiceLanguage = nil
        monitor = Task { @MainActor [weak self] in
            while Task.isCancelled == false {
                guard let self else { return }
                await refresh()
                do { try await Task.sleep(for: CompanionConfiguration.setupRecheckInterval) } catch { return }
            }
        }
    }

    func stop() {
        monitor?.cancel()
        monitor = nil
        permissionSequence?.cancel()
        permissionSequence = nil
        requestingAll = false
    }

    /// Requests every missing permission one after another. The automatic first-run pass skips anything it
    /// already asked for once (no request loop after a denial); an explicit "Einrichtung prüfen" passes `force`.
    func requestMissingPermissions(force: Bool) {
        guard permissionSequence == nil else { return }
        permissionSequence = Task { @MainActor [weak self] in
            await self?.runPermissionSequence(force: force)
            self?.permissionSequence = nil
        }
    }

    func runPermissionSequence(force: Bool) async {
        requestingAll = true
        defer { requestingAll = false }
        var asked = Set(preferences.stringArray(forKey: CompanionConfiguration.permissionsAskedKey) ?? [])
        for permission in CompanionPermission.requestOrder {
            guard Task.isCancelled == false else { return }
            await settings.refreshLivePermissions()
            state.observePermissions(settings.permissions)
            let status = settings.permissions[permission] ?? .notDetermined
            // Denied dialogs cannot be shown again; the step offers "In Systemeinstellungen öffnen" instead.
            guard status != .granted, status != .denied, status != .restricted else { continue }
            guard force || asked.contains(permission.rawValue) == false else { continue }
            if let step = GuidedSetupStep(rawValue: permission.rawValue) { state.select(step) }
            asked.insert(permission.rawValue)
            preferences.set(asked.sorted(), forKey: CompanionConfiguration.permissionsAskedKey)
            log.notice("Requesting permission \(permission.rawValue, privacy: .public)")
            await settings.request(permission)
            if permission == .screenRecording { restartSuggested = true }
            guard permission.needsSettingsToggle else { continue }
            await settings.refreshLivePermissions()
            guard settings.permissions[permission] != .granted else { continue }
            settings.openSettings(for: permission)
            await waitForToggle(permission)
        }
        await settings.refreshLivePermissions()
        state.observePermissions(settings.permissions)
        if let missing = CompanionPermission.requestOrder.first(where: { settings.permissions[$0] != .granted }),
           let step = GuidedSetupStep(rawValue: missing.rawValue) {
            state.select(step)
        }
    }

    /// Re-checks every 2 s until the toggle is on, the user moves to another step, or the wait ends.
    private func waitForToggle(_ permission: CompanionPermission) async {
        let step = GuidedSetupStep(rawValue: permission.rawValue)
        let deadline = ContinuousClock.now + CompanionConfiguration.settingsToggleWait
        while Task.isCancelled == false, ContinuousClock.now < deadline, state.current == step {
            do { try await Task.sleep(for: CompanionConfiguration.setupRecheckInterval) } catch { return }
            await settings.refreshLivePermissions()
            state.observePermissions(settings.permissions)
            if settings.permissions[permission] == .granted {
                if permission == .screenRecording { restartSuggested = true }
                return
            }
        }
    }

    /// Opens a fresh instance after this one quit, so macOS applies the screen recording grant.
    func relaunch() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "sleep 1; /usr/bin/open -n \"$0\"", Bundle.main.bundlePath]
        do { try process.run() } catch {
            log.error("Relaunch failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        NSApp.terminate(nil)
    }

    func select(_ step: GuidedSetupStep) { state.select(step) }
    func next() { state.next() }

    func fixCurrentPermission() async {
        guard let permission = state.current.permission else { return }
        await settings.request(permission)
        // AX, screen and input grants may arrive later. Always expose the relevant Settings pane.
        if settings.permissions[permission] != .granted { settings.openSettings(for: permission) }
        await settings.refreshLivePermissions()
        state.observePermissions(settings.permissions)
    }

    func retryConnection() {
        lastProbe = nil
        voiceLanguage = nil
        if state.status(for: .workspaceURL) != .verified || state.status(for: .bridge) != .verified {
            connection.reconnect()
            state.resetConnection()
        }
    }

    func refresh() async {
        guard checking == false else { return }
        checking = true
        defer { checking = false }
        await settings.refreshLivePermissions()
        guard Task.isCancelled == false else { return }
        state.observePermissions(settings.permissions)
        if connectionID != connection.connectionID || voiceLanguage.map({ $0 != settings.language }) == true {
            state.resetConnection()
            connectionID = connection.connectionID
            lastProbe = nil
            voiceLanguage = nil
        }
        guard state.current.permission == nil else { return }
        if let lastProbe, ContinuousClock.now - lastProbe < CompanionConfiguration.setupNetworkRetryInterval { return }
        lastProbe = .now
        await refreshConnection()
    }

    private func refreshConnection() async {
        let generation = connection.connectionID
        do {
            let result = try await connection.checkConnection()
            guard Task.isCancelled == false, generation == connection.connectionID else { return }
            state.observe(result.reachable ? .verified : .missing, for: .workspaceURL)
            state.observe(result.sessionCookie ? .verified : .missing, for: .session)
            state.observe(result.bridgeAcknowledged ? .verified : .missing, for: .bridge)
            guard result.reachable, result.sessionCookie, result.bridgeAcknowledged else {
                state.observe(.pending, for: .voiceProvider)
                voiceLanguage = nil
                return
            }
            await refreshVoice(generation: generation)
        } catch {
            guard Task.isCancelled == false, generation == connection.connectionID else { return }
            for step in [GuidedSetupStep.workspaceURL, .session, .bridge] { state.observe(.missing, for: step) }
            state.observe(.pending, for: .voiceProvider)
            voiceLanguage = nil
        }
    }

    private func refreshVoice(generation: UUID) async {
        // An Apple fallback is re-probed on every network interval, so ElevenLabs returns once the workspace is up.
        if voiceLanguage == settings.language, state.status(for: .voiceProvider) == .verified { return }
        let language = settings.language
        state.observe(.checking, for: .voiceProvider)
        let result = await connection.checkVoice(language: language, speechGranted: settings.permissions[.speechRecognition] == .granted)
        guard Task.isCancelled == false, generation == connection.connectionID, language == settings.language else { return }
        state.observe(result, for: .voiceProvider)
        voiceLanguage = language
    }

    @discardableResult
    func complete() -> Bool {
        guard state.canComplete else { return false }
        completed = true
        preferences.set(true, forKey: CompanionConfiguration.setupCompletedKey)
        settings.finishOnboarding()
        return true
    }
}
