// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import Foundation
import PostHog

public enum ConfigurationError: Error { case invalidAnalyticsHost }

public struct AnalyticsConfiguration: Equatable, Sendable {
    public let host: URL
    let projectToken: String

    public init?(environment: [String: String], optedIn: Bool) throws {
        guard optedIn, let address = environment["POSTHOG_HOST"],
            let token = environment["POSTHOG_PROJECT_TOKEN"], token.isEmpty == false
        else { return nil }
        guard let host = URL(string: address), host.scheme == "https", host.host?.isEmpty == false,
            host.user == nil, host.password == nil, host.query == nil, host.fragment == nil
        else {
            throw ConfigurationError.invalidAnalyticsHost
        }
        self.host = host
        projectToken = token
    }
}

@MainActor
public final class ClickyAnalytics {
    private var isEnabled = false

    public init() {}

    public func setConsent(_ optedIn: Bool, environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        guard let configuration = try AnalyticsConfiguration(environment: environment, optedIn: optedIn) else {
            if isEnabled {
                PostHogSDK.shared.optOut()
                PostHogSDK.shared.close()
            }
            isEnabled = false
            return
        }
        let config = PostHogConfig(projectToken: configuration.projectToken, host: configuration.host.absoluteString)
        config.captureApplicationLifecycleEvents = false
        config.captureScreenViews = false
        config.enableSwizzling = false
        config.preloadFeatureFlags = false
        // The macOS SDK has no session-replay implementation.
        PostHogSDK.shared.setup(config)
        PostHogSDK.shared.optIn()
        isEnabled = true
    }

    public func trackAppOpened() {
        guard isEnabled else { return }
        PostHogSDK.shared.capture("app_opened")
    }
}
