import AppKit
import Foundation
import Testing

@testable import LotseCore

@Suite(.serialized) @MainActor
struct CompanionOnboardingTests {
    private func preferences() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "lotse-onboarding-test-\(UUID())"))
    }

    @Test("FR-C7 first launch and rechecks inspect all permissions without requesting any access")
    func checksDoNotPrompt() throws {
        let access = PermissionAccessSpy()
        let model = CompanionSettingsModel(preferences: try preferences(), access: access)
        #expect(model.onboardingReviewed == false)
        #expect(model.permissions.count == CompanionPermission.allCases.count)
        model.refreshPermissions()
        #expect(access.requests.isEmpty)
        #expect(access.settingsOpened.isEmpty)
        #expect(model.permissions[.screenRecording] == .notGranted)
    }

    @Test("FR-C7 activating one permission requests only that capability and rechecks the actual grant")
    func explicitPermissionRequest() async throws {
        let access = PermissionAccessSpy()
        let model = CompanionSettingsModel(preferences: try preferences(), access: access)
        access.requestedStatus = .granted
        await model.request(.microphone)
        #expect(access.requests == [.microphone])
        #expect(model.permissions[.microphone] == .granted)
        #expect(model.permissions[.screenRecording] == .notGranted)
        #expect(model.requesting == nil)
        await model.request(.microphone)
        #expect(access.requests == [.microphone])
    }

    @Test("FR-C7 an asynchronous system prompt is never treated as a grant")
    func promptIsNotGrant() async throws {
        let access = PermissionAccessSpy()
        let model = CompanionSettingsModel(preferences: try preferences(), access: access)
        await model.request(.accessibility)
        #expect(model.permissions[.accessibility] == .notGranted)
        access.statuses[.accessibility] = .granted
        model.refreshPermissions()
        #expect(model.permissions[.accessibility] == .granted)
        access.statuses[.accessibility] = .notGranted
        model.refreshPermissions()
        #expect(model.permissions[.accessibility] == .notGranted)
    }

    @Test("FR-C7 denied and restricted permissions link to Settings instead of prompting again",
          arguments: [CompanionPermissionStatus.denied, .restricted])
    func deniedPermission(status: CompanionPermissionStatus) async throws {
        let access = PermissionAccessSpy()
        access.statuses[.microphone] = status
        let model = CompanionSettingsModel(preferences: try preferences(), access: access)
        await model.request(.microphone)
        model.openSettings(for: .microphone)
        #expect(access.requests.isEmpty)
        #expect(access.settingsOpened == [.microphone])
        #expect(model.settingsError == false)
        access.canOpenSettings = false
        model.openSettings(for: .screenRecording)
        #expect(model.settingsError)
    }

    @Test("FR-C7 entering the workspace without grants persists onboarding review but never permissions")
    func workspaceWithoutPermissions() throws {
        let preferences = try preferences()
        let access = PermissionAccessSpy()
        let model = CompanionSettingsModel(preferences: preferences, access: access)
        model.language = .english
        model.voiceIdentifier = "selected-system-voice"
        model.voiceEnabled = true
        model.finishOnboarding()
        let restored = CompanionSettingsModel(preferences: preferences, access: access)
        #expect(restored.onboardingReviewed)
        #expect(restored.voiceEnabled)
        #expect(restored.language == .english)
        #expect(restored.voiceIdentifier == "selected-system-voice")
        #expect(restored.permissions.values.allSatisfy { $0 == .notGranted })
        #expect(access.requests.isEmpty)
        model.language = .german
        #expect(model.voiceIdentifier.isEmpty)
    }

    @Test("FR-C7 every permission has a distinct Privacy and Security deep link")
    func permissionLinks() {
        let links = CompanionPermission.allCases.compactMap(\.settingsURL)
        #expect(links.count == CompanionPermission.allCases.count)
        #expect(Set(links).count == links.count)
        #expect(links.allSatisfy { $0.scheme == "x-apple.systempreferences" })
        #expect(CompanionPermission.inputMonitoring.settingsURL?.query == "Privacy_ListenEvent")
    }
}

@Suite(.serialized) @MainActor
struct CompanionPanelTests {
    @Test("FR-C7 panel status reflects workspace failure, voice opt-in, and language changes")
    func panelStatus() {
        _ = NSApplication.shared
        let menu = MenuBarController()
        menu.updateStatus(workspace: .unavailable, voiceEnabled: true, voiceAvailable: false, recording: false)
        #expect(menu.statusItem.title == CompanionCopy().disconnected)
        #expect(menu.voiceStatusItem.title == CompanionCopy().voiceNeedsPermission)
        menu.setLanguage(.english)
        #expect(menu.statusItem.title == CompanionCopy(language: .english).disconnected)
        menu.updateStatus(workspace: .connected, voiceEnabled: true, voiceAvailable: true, recording: true)
        #expect(menu.voiceStatusItem.title == CompanionCopy(language: .english).listening)
    }
}

@MainActor
private final class PermissionAccessSpy: CompanionPermissionAccess {
    func refresh() async {}
    var statuses: [CompanionPermission: CompanionPermissionStatus] = [:]
    var requests: [CompanionPermission] = []
    var settingsOpened: [CompanionPermission] = []
    var requestedStatus = CompanionPermissionStatus.notGranted
    var canOpenSettings = true

    func status(for permission: CompanionPermission) -> CompanionPermissionStatus { statuses[permission] ?? .notGranted }
    func request(_ permission: CompanionPermission) async {
        requests.append(permission)
        statuses[permission] = requestedStatus
    }
    func openSettings(for permission: CompanionPermission) -> Bool {
        settingsOpened.append(permission)
        return canOpenSettings
    }
}
