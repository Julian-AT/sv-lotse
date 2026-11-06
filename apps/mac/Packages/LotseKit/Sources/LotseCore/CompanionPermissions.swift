import AppKit
@preconcurrency import ApplicationServices
import AVFoundation
import CoreGraphics
import EventKit
import IOKit.hid
import LotseVoice
@preconcurrency import Speech
import UserNotifications

public enum CompanionPermission: String, CaseIterable, Identifiable, Sendable {
    case microphone, speechRecognition, screenRecording, accessibility, inputMonitoring, notifications, calendar
    public var id: String { rawValue }

    /// Order of the automatic first-run requests: system dialogs first, then the three that need a Settings toggle.
    public static let requestOrder: [CompanionPermission] = [
        .microphone, .speechRecognition, .notifications, .calendar, .screenRecording, .accessibility, .inputMonitoring
    ]

    /// These cannot be granted from a dialog; macOS only lists the app in System Settings.
    public var needsSettingsToggle: Bool { self == .screenRecording || self == .accessibility || self == .inputMonitoring }

    public var settingsURL: URL? {
        if self == .notifications {
            var url = URLComponents(string: CompanionConfiguration.notificationSettings)
            url?.queryItems = [URLQueryItem(name: "id", value: Bundle.main.bundleIdentifier)]
            return url?.url
        }
        let pane: String
        switch self {
        case .microphone: pane = "Privacy_Microphone"
        case .screenRecording: pane = "Privacy_ScreenCapture"
        case .accessibility: pane = "Privacy_Accessibility"
        case .inputMonitoring: pane = "Privacy_ListenEvent"
        case .speechRecognition: pane = "Privacy_SpeechRecognition"
        case .calendar: pane = "Privacy_Calendars"
        case .notifications: return nil
        }
        return URL(string: "\(CompanionConfiguration.privacySettings)?\(pane)")
    }
}

public enum CompanionPermissionStatus: Sendable {
    case granted, notDetermined, notGranted, denied, restricted

    public var canRequest: Bool { self == .notDetermined || self == .notGranted }
}

@MainActor
protocol CompanionPermissionAccess {
    func refresh() async
    func status(for permission: CompanionPermission) -> CompanionPermissionStatus
    func request(_ permission: CompanionPermission) async
    func openSettings(for permission: CompanionPermission) -> Bool
}

@MainActor
final class SystemCompanionPermissionAccess: CompanionPermissionAccess {
    private var notificationStatus: CompanionPermissionStatus = .notDetermined

    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: notificationStatus = .granted
        case .notDetermined: notificationStatus = .notDetermined
        case .denied: notificationStatus = .denied
        @unknown default: notificationStatus = .notGranted
        }
    }

    func status(for permission: CompanionPermission) -> CompanionPermissionStatus {
        switch permission {
        case .microphone: microphoneStatus()
        case .screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .notGranted
        case .accessibility: AXIsProcessTrusted() ? .granted : .notGranted
        case .inputMonitoring: inputMonitoringStatus()
        case .calendar: calendarStatus()
        case .speechRecognition: speechStatus()
        case .notifications: notificationStatus
        }
    }

    private func microphoneStatus() -> CompanionPermissionStatus {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: .granted
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        @unknown default: .notGranted
        }
    }

    private func inputMonitoringStatus() -> CompanionPermissionStatus {
        switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
        case kIOHIDAccessTypeGranted: .granted
        case kIOHIDAccessTypeDenied: .denied
        default: .notDetermined
        }
    }

    private func calendarStatus() -> CompanionPermissionStatus {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .writeOnly: .granted
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        @unknown default: .notGranted
        }
    }

    private func speechStatus() -> CompanionPermissionStatus {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: .granted
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        @unknown default: .notGranted
        }
    }

    /// TCC calls these completion handlers on a background queue. Every callback goes through
    /// `SystemCallbacks.value`, whose closures are nonisolated, so none inherits main-actor isolation.
    func request(_ permission: CompanionPermission) async {
        switch permission {
        case .microphone:
            _ = await SystemCallbacks.value { AVCaptureDevice.requestAccess(for: .audio, completionHandler: $0) }
        case .screenRecording: _ = CGRequestScreenCaptureAccess()
        case .accessibility:
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        case .inputMonitoring: _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
        case .speechRecognition: _ = await SystemCallbacks.speechAuthorization()
        case .notifications:
            _ = await SystemCallbacks.value { done in
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    done(granted)
                }
            }
            await refresh()
        case .calendar:
            _ = await SystemCallbacks.value { done in
                EKEventStore.lotseShared.requestWriteOnlyAccessToEvents { granted, _ in done(granted) }
            }
        }
    }

    func openSettings(for permission: CompanionPermission) -> Bool {
        if let url = permission.settingsURL, NSWorkspace.shared.open(url) { return true }
        guard let fallback = URL(string: CompanionConfiguration.settingsFallback) else { return false }
        return NSWorkspace.shared.open(fallback)
    }
}

extension EKEventStore {
    /// One long-lived store keeps the request alive until its completion handler runs.
    nonisolated(unsafe) static let lotseShared = EKEventStore()
}
