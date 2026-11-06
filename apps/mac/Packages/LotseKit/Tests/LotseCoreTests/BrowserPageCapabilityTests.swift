import CoreGraphics
import Foundation
@testable import LotseCore
import LotseGuidedWindow
import LotseProtocol
import LotseResolver
import Testing

private struct Node: BrowserAXNode {
    var role: String?
    var subrole: String?
    var title: String?
    var nodeDescription: String?
    var placeholder: String?
    var value: String?
    var url: String?
    var frame: CGRect? = CGRect(x: 0, y: 700, width: 100, height: 20)
    var children: [Node] = []
}

private func open(_ url: String) -> Action {
    .openResource(.init(id: "open-page", kind: .openResource, payload: .init(label: nil, style: nil),
        sentenceIndex: 0, target: .dom(.init(handle: "page", kind: .dom, url: url))))
}

@Suite(.serialized) @MainActor
struct BrowserPageCapabilityTests {
    @Test func readinessNeedsTheRequestedOriginAndContent() {
        let requested = "https://www.sozialversicherung.at/pflegegeld"
        #expect(BrowserPageCapability.pageReady(url: "https://www.sozialversicherung.at/other", childCount: 3, requested: requested))
        #expect(BrowserPageCapability.pageReady(url: "https://evil.example/pflegegeld", childCount: 3, requested: requested) == false)
        #expect(BrowserPageCapability.pageReady(url: requested, childCount: 0, requested: requested) == false)
        #expect(BrowserPageCapability.pageReady(url: nil, childCount: 3, requested: requested) == false)
    }

    @Test func waitsForTheProbeAndTimesOut() async {
        var calls = 0
        let ready = await BrowserPageCapability.awaitReady(timeout: .seconds(2), interval: .milliseconds(10)) {
            calls += 1
            return calls >= 3 ? "https://www.sozialversicherung.at/" : nil
        }
        #expect(ready == "https://www.sozialversicherung.at/")
        let never = await BrowserPageCapability.awaitReady(timeout: .milliseconds(80), interval: .milliseconds(10)) { nil }
        #expect(never == nil)
    }

    @Test func refusesPagesOutsideTheAllowlistAndLoginPages() async throws {
        let capability = BrowserPageCapability()
        capability.policy = try GuidedOriginPolicy(origins: ["https://www.sozialversicherung.at"])
        #expect(capability.allows("https://www.sozialversicherung.at/pflegegeld"))
        #expect(capability.allows("https://www.sozialversicherung.at/login") == false)
        #expect(capability.allows("http://www.sozialversicherung.at/pflegegeld") == false)
        let result = await capability.open(open("https://evil.example/"))
        #expect(result.success == false && result.failureReason == "origin-not-allowed")
        #expect(capability.active == nil)
    }

    @Test func pageSnapshotCarriesTitleAndHandlesWithoutPasswords() {
        let area = Node(role: "AXWebArea", title: "Pflegegeld", url: "https://www.sozialversicherung.at/p",
            frame: CGRect(x: 0, y: 0, width: 1000, height: 800), children: [
                Node(role: "AXTextField", title: "Vorname"),
                Node(role: "AXTextField", subrole: "AXSecureTextField", title: "Passwort", value: "x")
            ])
        let page = BrowserPageCapability.page(url: area.url!, area: area, frame: area.frame!)
        #expect(page.url == "https://www.sozialversicherung.at/p")
        #expect(page.handles.map(\.id).first == "page")
        #expect(page.handles.first?.label == "Pflegegeld")
        #expect(page.handles.map(\.label) == ["Pflegegeld", "Vorname"])
    }

    @Test func claimsOnlyDomOpensInBrowserMode() {
        let capability = BrowserPageCapability()
        UserDefaults.standard.removeObject(forKey: PortalPageMode.defaultsKey)
        #expect(capability.claimsOpen(open("https://www.sozialversicherung.at/")))
        UserDefaults.standard.set("guided", forKey: PortalPageMode.defaultsKey)
        #expect(capability.claimsOpen(open("https://www.sozialversicherung.at/")) == false)
        UserDefaults.standard.removeObject(forKey: PortalPageMode.defaultsKey)
        #expect(capability.claimsDisplay(.dom(.init(handle: "x", kind: .dom, url: "https://www.sozialversicherung.at/"))) == false)
    }

    @Test func fillWithoutServerApprovalTypesNothing() async {
        let capability = BrowserPageCapability()
        let invocation = ToolInvocation(input: [
            "target": .unionMap(["kind": .string("dom"), "handle": .string("ax-1"), "url": .string("https://www.sozialversicherung.at/")]),
            "value": .string("Anna"),
            "provenance": .unionMap(["kind": .string("user")])
        ], toolCallID: "fill-1", toolName: .uiFill)
        var moved = false
        let output = await capability.fill(invocation, approvals: GuidedFillApprovals()) { _, _ in moved = true }
        guard case .actionResult(let result) = output.output else { Issue.record("no result"); return }
        #expect(result.success == false && result.failureReason == "APPROVAL_REQUIRED")
        #expect(moved == false)
    }
}

@Suite @MainActor
struct BrowserNavigationTests {
    @Test func readinessIgnoresAnOlderTabOfTheSameSiteAtFirst() {
        let requested = "https://www.pv.at/web/pflegegeld"
        #expect(BrowserPageCapability.pageReady(url: "https://www.pv.at/web/reha", childCount: 3, requested: requested,
            exactOnly: true) == false)
        #expect(BrowserPageCapability.pageReady(url: "https://www.pv.at/web/pflegegeld/", childCount: 3, requested: requested,
            exactOnly: true))
    }

    @Test func scrollingDownPicksTheElementAboutOneScreenBelow() {
        let page = CGRect(x: 0, y: 200, width: 1000, height: 800)
        let elements: [(String, CGRect)] = [
            ("visible", CGRect(x: 0, y: 500, width: 10, height: 10)),
            ("just-below", CGRect(x: 0, y: 150, width: 10, height: 10)),
            ("one-screen", CGRect(x: 0, y: -440, width: 10, height: 10)),
            ("far", CGRect(x: 0, y: -2000, width: 10, height: 10))
        ]
        #expect(BrowserPageCapability.scrollTarget(elements, page: page, up: false) == "one-screen")
        #expect(BrowserPageCapability.scrollTarget(elements, page: page, up: true) == nil)
    }
}
