import Foundation
import LotseBridge
import Testing

@testable import LotseCore

@Suite(.serialized) @MainActor
struct GuidedSetupTests {
    @Test("First-run steps follow the permission, workspace, session, hello and voice sequence")
    func stepOrder() {
        var state = GuidedSetupState()
        for step in GuidedSetupStep.allCases {
            #expect(state.current == step)
            #expect(state.status(for: step) == .pending)
            state.next()
        }
        #expect(state.current == .voiceProvider)
        #expect(state.canComplete == false)
    }

    @Test("Moving past a missing permission never verifies it or permits completion")
    func continuingIsNotVerification() {
        var state = GuidedSetupState()
        state.observe(.missing, for: .microphone)
        state.next()
        #expect(state.current == .speechRecognition)
        #expect(state.status(for: .microphone) == .missing)
        #expect(state.canComplete == false)
    }

    @Test("Only live grants satisfy permission steps and revocation invalidates completion")
    func livePermissionChanges() {
        var state = satisfiedState()
        #expect(state.canComplete)
        var permissions = grantedPermissions()
        permissions[.screenRecording] = .notGranted
        state.observePermissions(permissions)
        #expect(state.status(for: .screenRecording) == .missing)
        #expect(state.canComplete == false)
        state.observePermissions(grantedPermissions())
        #expect(state.canComplete)
    }

    @Test("A verified Apple fallback completes voice readiness while pending and missing never do")
    func fallbackReadiness() {
        var state = satisfiedState()
        state.observe(.appleFallback, for: .voiceProvider)
        #expect(state.canComplete)
        #expect(state.verifiedCount == GuidedSetupStep.allCases.count)
        for status in [GuidedSetupStatus.pending, .checking, .missing] {
            state.observe(status, for: .voiceProvider)
            #expect(state.canComplete == false)
        }
    }

    @Test("Navigating invalidates every connection observation while preserving permission observations")
    func connectionInvalidation() {
        var state = satisfiedState()
        state.resetConnection()
        #expect(state.status(for: .microphone) == .verified)
        for step in GuidedSetupStep.allCases where step.permission == nil {
            #expect(state.status(for: step) == .pending)
        }
        #expect(state.canComplete == false)
    }

    @Test("First-run checks never request permissions or create provider tokens before the connection step")
    func checksArePassive() async throws {
        let fixture = try makeModel()
        let (model, permissions) = (fixture.model, fixture.permissions)
        let connection = fixture.connection
        await model.refresh()
        #expect(permissions.requests.isEmpty)
        #expect(connection.checks == 0)
        #expect(connection.voiceChecks == 0)
        #expect(model.complete() == false)
    }

    @Test("First start requests each missing permission once, in order, and never re-asks a denial")
    func automaticPermissionSequence() async throws {
        let fixture = try makeModel()
        let (model, permissions) = (fixture.model, fixture.permissions)
        for permission in CompanionPermission.allCases { permissions.statuses[permission] = .granted }
        permissions.statuses[.microphone] = .notDetermined
        permissions.statuses[.speechRecognition] = .denied
        permissions.statuses[.calendar] = .notDetermined
        permissions.statuses[.screenRecording] = .notGranted
        permissions.grantOnRequest = [.microphone, .calendar, .screenRecording]
        await model.runPermissionSequence(force: false)
        #expect(permissions.requests == [.microphone, .calendar, .screenRecording])
        #expect(model.restartSuggested)
        permissions.statuses[.calendar] = .notGranted
        await model.runPermissionSequence(force: false)
        #expect(permissions.requests == [.microphone, .calendar, .screenRecording])
    }

    @Test("Only verified workspace, stored session and acknowledged hello allow a voice check")
    func prerequisites() async throws {
        let fixture = try makeModel()
        let (model, connection) = (fixture.model, fixture.connection)
        connection.result = WorkspaceSetupDiagnostics(reachable: true, sessionCookie: false, bridgeAcknowledged: true)
        model.select(.workspaceURL)
        await model.refresh()
        #expect(model.state.status(for: .workspaceURL) == .verified)
        #expect(model.state.status(for: .session) == .missing)
        #expect(connection.voiceChecks == 0)
        #expect(model.complete() == false)
    }

    @Test("Completion persists only after all live checks and a fresh run still checks permissions")
    func persistsCompletion() async throws {
        let fixture = try makeModel()
        let (model, permissions) = (fixture.model, fixture.permissions)
        let (connection, preferences) = (fixture.connection, fixture.preferences)
        permissions.statuses = grantedPermissions()
        connection.voiceStatus = .appleFallback
        model.select(.voiceProvider)
        await model.refresh()
        #expect(model.state.canComplete)
        #expect(model.complete())
        #expect(preferences.bool(forKey: CompanionConfiguration.setupCompletedKey))
        let restored = GuidedSetupModel(settings: model.settings, connection: connection, preferences: preferences)
        #expect(restored.completed)
        #expect(restored.state.canComplete == false)
        permissions.statuses[.notifications] = .denied
        await restored.refresh()
        #expect(restored.state.status(for: .notifications) == .missing)
    }

    @Test("A successful token probe is cached while permission preflights remain live")
    func avoidsTokenPolling() async throws {
        let fixture = try makeModel()
        let (model, permissions) = (fixture.model, fixture.permissions)
        let connection = fixture.connection
        permissions.statuses = grantedPermissions()
        model.select(.voiceProvider)
        await model.refresh()
        await model.refresh()
        #expect(connection.voiceChecks == 1)
        permissions.statuses[.microphone] = .denied
        await model.refresh()
        #expect(model.state.status(for: .microphone) == .missing)
        #expect(model.state.canComplete == false)
    }

    @Test("Explicit Fix requests one permission and links to its pane until its actual grant arrives")
    func fixPermission() async throws {
        let fixture = try makeModel()
        let (model, permissions) = (fixture.model, fixture.permissions)
        model.select(.inputMonitoring)
        await model.fixCurrentPermission()
        #expect(permissions.requests == [.inputMonitoring])
        #expect(permissions.opened == [.inputMonitoring])
        #expect(model.state.status(for: .inputMonitoring) == .missing)
        permissions.statuses[.inputMonitoring] = .granted
        await model.refresh()
        #expect(model.state.status(for: .inputMonitoring) == .verified)
    }

    @Test("Reloading the same workspace URL invalidates the voice check and probes the new bridge")
    func reloadInvalidatesVoice() async throws {
        let fixture = try makeModel()
        let (model, permissions) = (fixture.model, fixture.permissions)
        let connection = fixture.connection
        permissions.statuses = grantedPermissions()
        model.select(.voiceProvider)
        await model.refresh()
        connection.connectionID = UUID()
        connection.result = WorkspaceSetupDiagnostics(reachable: true, sessionCookie: true, bridgeAcknowledged: false)
        await model.refresh()
        #expect(model.state.status(for: .bridge) == .missing)
        #expect(model.state.status(for: .voiceProvider) == .pending)
        #expect(model.state.canComplete == false)
        #expect(connection.voiceChecks == 1)
    }

    private func grantedPermissions() -> [CompanionPermission: CompanionPermissionStatus] {
        Dictionary(uniqueKeysWithValues: CompanionPermission.allCases.map { ($0, .granted) })
    }

    private func satisfiedState() -> GuidedSetupState {
        var state = GuidedSetupState()
        for step in GuidedSetupStep.allCases { state.observe(.verified, for: step) }
        return state
    }

    private func makeModel() throws -> SetupFixture {
        let preferences = try #require(UserDefaults(suiteName: "lotse-guided-setup-test-\(UUID())"))
        let permissions = SetupPermissionSpy()
        let settings = CompanionSettingsModel(preferences: preferences, access: permissions)
        let connection = SetupConnectionSpy()
        return SetupFixture(
            model: GuidedSetupModel(settings: settings, connection: connection, preferences: preferences),
            permissions: permissions, connection: connection, preferences: preferences
        )
    }
}

@MainActor
private final class SetupPermissionSpy: CompanionPermissionAccess {
    var statuses: [CompanionPermission: CompanionPermissionStatus] = [:]
    var requests: [CompanionPermission] = []
    var opened: [CompanionPermission] = []
    func refresh() async {}
    func status(for permission: CompanionPermission) -> CompanionPermissionStatus { statuses[permission] ?? .notGranted }
    var grantOnRequest: Set<CompanionPermission> = []
    func request(_ permission: CompanionPermission) async {
        requests.append(permission)
        if grantOnRequest.contains(permission) { statuses[permission] = .granted }
    }
    func openSettings(for permission: CompanionPermission) -> Bool { opened.append(permission); return true }
}

@MainActor
private final class SetupConnectionSpy: GuidedSetupConnectionAccess {
    var connectionID = UUID()
    var checks = 0
    var voiceChecks = 0
    var voiceStatus = GuidedSetupStatus.verified
    var result = WorkspaceSetupDiagnostics(reachable: true, sessionCookie: true, bridgeAcknowledged: true)
    func reconnect() { connectionID = UUID() }
    func checkConnection() async throws -> WorkspaceSetupDiagnostics { checks += 1; return result }
    func checkVoice(language: CompanionLanguage, speechGranted: Bool) async -> GuidedSetupStatus {
        voiceChecks += 1
        return voiceStatus
    }
}

@MainActor
private struct SetupFixture {
    let model: GuidedSetupModel
    let permissions: SetupPermissionSpy
    let connection: SetupConnectionSpy
    let preferences: UserDefaults
}
