import Foundation

enum GuidedSetupStep: String, CaseIterable, Identifiable, Sendable {
    case microphone, speechRecognition, screenRecording, accessibility, inputMonitoring, notifications, calendar
    case workspaceURL, session, bridge, voiceProvider

    var id: String { rawValue }
    var permission: CompanionPermission? { CompanionPermission(rawValue: rawValue) }
}

enum GuidedSetupStatus: Equatable, Sendable {
    case pending, checking, missing, verified, appleFallback

    var isSatisfied: Bool { self == .verified || self == .appleFallback }
}

struct GuidedSetupState: Equatable, Sendable {
    private(set) var current: GuidedSetupStep = .microphone
    private(set) var statuses: [GuidedSetupStep: GuidedSetupStatus] = [:]

    var canComplete: Bool { GuidedSetupStep.allCases.allSatisfy { status(for: $0).isSatisfied } }
    var verifiedCount: Int { GuidedSetupStep.allCases.filter { status(for: $0).isSatisfied }.count }

    func status(for step: GuidedSetupStep) -> GuidedSetupStatus { statuses[step] ?? .pending }

    mutating func select(_ step: GuidedSetupStep) { current = step }

    mutating func next() {
        guard let index = GuidedSetupStep.allCases.firstIndex(of: current),
              let next = GuidedSetupStep.allCases.dropFirst(index + 1).first else { return }
        current = next
    }

    mutating func observe(_ status: GuidedSetupStatus, for step: GuidedSetupStep) {
        statuses[step] = status
    }

    mutating func observePermissions(_ permissions: [CompanionPermission: CompanionPermissionStatus]) {
        for step in GuidedSetupStep.allCases {
            guard let permission = step.permission else { continue }
            observe(permissions[permission] == .granted ? .verified : .missing, for: step)
        }
    }

    mutating func resetConnection() {
        for step in GuidedSetupStep.allCases where step.permission == nil { statuses[step] = .pending }
    }
}
