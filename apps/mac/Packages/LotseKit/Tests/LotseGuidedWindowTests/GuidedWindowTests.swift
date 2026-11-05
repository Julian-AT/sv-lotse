import Testing
import WebKit

@testable import LotseGuidedWindow

@Test("NFR-10 guided windows use isolated storage and exact origins") @MainActor
func isolatedConfiguration() throws {
    let policy = try GuidedOriginPolicy(origins: ["https://portal.example.at"])
    #expect(policy.allows("https://portal.example.at/path"))
    #expect(policy.allows("https://portal.example.at.evil.test") == false)
    #expect(policy.allows("https://portal.example.at:444") == false)
    let configuration = GuidedWindowConfiguration.make()
    #expect(configuration.websiteDataStore.isPersistent == false)
    #expect(configuration.userContentController.userScripts.isEmpty)
}
