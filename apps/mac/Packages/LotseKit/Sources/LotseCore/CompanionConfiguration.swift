import Foundation

public enum CompanionConfiguration {
    public static let dashboardRefreshInterval: Duration = .seconds(20)
    public static let feedbackURL = "https://github.com/Julian-AT/sv-lotse/issues"
    public static let captureExclusionsKey = "captureExcludedBundleIdentifiers"
    public static let onboardingReviewedKey = "companionOnboardingReviewed"
    public static let voiceEnabledKey = "companionVoiceEnabled"
    public static let languageKey = "companionLanguage"
    public static let voiceIdentifierKey = "companionVoiceIdentifier"
    public static let privacySettings = "x-apple.systempreferences:com.apple.preference.security"
    public static let settingsFallback = "x-apple.systempreferences:"
    public static let notificationSettings = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
    public static let setupCompletedKey = "companionGuidedSetupCompletedV1"
    public static let setupRecheckInterval: Duration = .seconds(2)
    /// Permissions the automatic first-run flow already asked for; it never asks again on its own.
    public static let permissionsAskedKey = "companionPermissionsAskedV1"
    /// How long the automatic flow waits for a System Settings toggle before moving on.
    public static let settingsToggleWait: Duration = .seconds(90)
    public static let setupNetworkRetryInterval: Duration = .seconds(10)
}

public enum CompanionLanguage: String, CaseIterable, Sendable {
    case german = "de-AT"
    case english = "en-GB"

    public var title: String { self == .german ? "Deutsch" : "English" }
    public var providerLanguage: String { self == .german ? "de" : "en" }

    public static func load(from preferences: UserDefaults) -> Self {
        preferences.string(forKey: CompanionConfiguration.languageKey).flatMap(Self.init(rawValue:)) ?? .german
    }
}
