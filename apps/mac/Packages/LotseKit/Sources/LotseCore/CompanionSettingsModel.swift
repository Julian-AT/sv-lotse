import AVFoundation
import Foundation
import LotseVoice
import Observation

@MainActor @Observable
public final class CompanionSettingsModel {
    public private(set) var permissions: [CompanionPermission: CompanionPermissionStatus] = [:]
    public private(set) var requesting: CompanionPermission?
    public private(set) var settingsError = false
    public private(set) var onboardingReviewed: Bool
    public var onPermissionsChanged: (() -> Void)?
    public var onLanguageChanged: (() -> Void)?
    public var onVoiceEnabledChanged: (() -> Void)?
    /// Live state of the push-to-talk event tap, shown in Settings › Sprache & Stimme.
    public var shortcutStatus: PushToTalkMonitorStatus = .off
    public var voiceEnabled: Bool {
        didSet {
            preferences.set(voiceEnabled, forKey: CompanionConfiguration.voiceEnabledKey)
            onVoiceEnabledChanged?()
        }
    }
    public var language: CompanionLanguage {
        didSet {
            preferences.set(language.rawValue, forKey: CompanionConfiguration.languageKey)
            voiceIdentifier = ""
            stopSample()
            onLanguageChanged?()
        }
    }
    public var voiceIdentifier: String {
        didSet { preferences.set(voiceIdentifier, forKey: CompanionConfiguration.voiceIdentifierKey) }
    }
    @ObservationIgnored private let preferences: UserDefaults
    @ObservationIgnored private let access: CompanionPermissionAccess
    @ObservationIgnored private var synthesizer: AVSpeechSynthesizer?

    public convenience init(preferences: UserDefaults = .standard) {
        self.init(preferences: preferences, access: SystemCompanionPermissionAccess())
    }

    init(preferences: UserDefaults, access: CompanionPermissionAccess) {
        self.preferences = preferences
        self.access = access
        // Push-to-talk is on by default once Input Monitoring is granted; an explicit choice wins.
        voiceEnabled = preferences.object(forKey: CompanionConfiguration.voiceEnabledKey) as? Bool
            ?? GlobalPushToTalkShortcutMonitor.inputMonitoringGranted
        language = .load(from: preferences)
        voiceIdentifier = preferences.string(forKey: CompanionConfiguration.voiceIdentifierKey) ?? ""
        onboardingReviewed = preferences.bool(forKey: CompanionConfiguration.onboardingReviewedKey)
        refreshPermissions()
    }

    var copy: CompanionCopy { CompanionCopy(language: language) }

    var voices: [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix(String(language.rawValue.prefix(2))) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    public func refreshPermissions() {
        permissions = Dictionary(uniqueKeysWithValues: CompanionPermission.allCases.map { ($0, access.status(for: $0)) })
        onPermissionsChanged?()
    }

    public func refreshLivePermissions() async {
        await access.refresh()
        refreshPermissions()
    }

    public func request(_ permission: CompanionPermission) async {
        guard requesting == nil, access.status(for: permission).canRequest else {
            refreshPermissions()
            return
        }
        requesting = permission
        await access.request(permission)
        requesting = nil
        // Request return values do not imply a grant (AX prompts are asynchronous).
        refreshPermissions()
    }

    public func openSettings(for permission: CompanionPermission) {
        settingsError = access.openSettings(for: permission) == false
    }

    public func finishOnboarding() {
        onboardingReviewed = true
        preferences.set(true, forKey: CompanionConfiguration.onboardingReviewedKey)
        stopSample()
    }

    func playSample() {
        stopSample()
        let synthesizer = synthesizer ?? AVSpeechSynthesizer()
        self.synthesizer = synthesizer
        let utterance = AVSpeechUtterance(string: copy.sample)
        utterance.voice = AVSpeechSynthesisVoice(identifier: voiceIdentifier) ?? AVSpeechSynthesisVoice(language: language.rawValue)
        synthesizer.speak(utterance)
    }

    func stopSample() { synthesizer?.stopSpeaking(at: .immediate) }
}
