import Testing
import WebKit

@testable import LotseGuidedWindow

@Test("NFR-10 guided windows use isolated storage and exact origins") @MainActor
func isolatedConfiguration() throws {
    let policy = try GuidedOriginPolicy(origins: ["https://portal.example.at"])
    #expect(policy.allows("https://portal.example.at/path"))
    #expect(policy.allows("https://portal.example.at.evil.test") == false)
    #expect(policy.allows("https://portal.example.at:444") == false)
    #expect(policy.allows("https://portal.example.at:443/form"))
    #expect(policy.allows("http://portal.example.at") == false)
    #expect(policy.allows("https://portal.example.at@evil.test") == false)
    #expect(policy.allows("https://user:password@portal.example.at") == false)
    #expect(policy.allows("file:///tmp/form.html") == false)
    #expect(policy.allows("javascript:alert(1)") == false)
    #expect(policy.allows("blob:https://portal.example.at/id") == false)
    #expect(policy.allowsDownload("blob:https://portal.example.at/id"))
    #expect(policy.allowsDownload("blob:https://evil.test/id") == false)
    #expect(policy.allowsDownload("blob:null/id") == false)
    let configuration = GuidedWindowConfiguration.make()
    #expect(configuration.websiteDataStore.isPersistent == false)
    #expect(configuration.userContentController.userScripts.isEmpty)
    let second = GuidedWindowConfiguration.make(guideSource: "window.guide = true;")
    #expect(configuration.userContentController !== second.userContentController)
    #expect(configuration.websiteDataStore !== second.websiteDataStore)
    let script = try #require(second.userContentController.userScripts.first)
    #expect(script.isForMainFrameOnly)
    #expect(script.injectionTime == .atDocumentEnd)
    #expect(GuidedWindowConfiguration.contentWorld !== WKContentWorld.page)
}
