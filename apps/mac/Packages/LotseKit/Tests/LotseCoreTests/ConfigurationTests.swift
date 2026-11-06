import Foundation
import Testing

@testable import LotseCore

@Test("NFR-11 analytics requires explicit consent and a configured host")
func analyticsConsent() throws {
    #expect(try AnalyticsConfiguration(environment: [:], optedIn: false) == nil)
    #expect(try AnalyticsConfiguration(environment: [:], optedIn: true) == nil)
    let environment = ["POSTHOG_HOST": "https://analytics.example.at", "POSTHOG_PROJECT_TOKEN": "test-project"]
    #expect(try AnalyticsConfiguration(environment: environment, optedIn: false) == nil)
    let configuration = try #require(try AnalyticsConfiguration(environment: environment, optedIn: true))
    #expect(configuration.host.absoluteString == "https://analytics.example.at")
    #expect(throws: ConfigurationError.self) {
        try AnalyticsConfiguration(environment: ["POSTHOG_HOST": "file:///tmp", "POSTHOG_PROJECT_TOKEN": "test"], optedIn: true)
    }
}
