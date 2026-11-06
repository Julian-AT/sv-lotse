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

    @Test func tourEndsOnTheApplicationDocumentOrForm() {
        let page = "https://www.pv.at/web/pflegegeld"
        let elements: [(role: String, label: String, url: String?)] = [
            ("link", "Pflegegeld-Antrag", page + "#zeilenkonzept"),
            ("link", "Anspruch auf Pflegegeld (PDF, 164 KB)", "https://www.pv.at/cdscontent/load?contentid=1"),
            ("heading", "Antrag auf Pflegegeld", nil),
            ("link", "Online-Antrag", "https://www.sozialversicherung.gv.at/formgen/?contentid=1"),
            ("link", "Antrag (PDF)", "https://www.pv.at/cdscontent/load?contentid=2"),
            ("link", "Absenden", "https://www.pv.at/send")
        ]
        #expect(BrowserPageCapability.applicationTargets(elements, page: page) == [4, 3, 2, 1])
        let ministry: [(role: String, label: String, url: String?)] = [
            ("heading", "Voraussetzungen", nil), ("heading", "Wie beantrage ich Pflegegeld?", nil),
            ("link", "Formular Nr. 36", "https://www.oesterreich.gv.at/dam/jcr:1/antrag_pflegegl.pdf")
        ]
        #expect(BrowserPageCapability.applicationTarget(ministry, page: "https://www.oesterreich.gv.at/a") == 2)
        let none: [(role: String, label: String, url: String?)] = [("link", "Kontakt", "https://www.oegk.at/kontakt")]
        #expect(BrowserPageCapability.applicationTarget(none, page: "https://www.oegk.at/a") == nil)
    }

    @Test func tourOutlinesTheEnclosingBlockNotTheWholePage() {
        let page = CGRect(x: 0, y: 100, width: 1700, height: 900)
        let heading = CGRect(x: 400, y: 600, width: 300, height: 36)
        let ancestors: [(role: String, frame: CGRect)] = [
            ("AXGroup", CGRect(x: 400, y: 600, width: 300, height: 40)),
            ("AXGroup", CGRect(x: 380, y: 450, width: 900, height: 220)),
            ("AXGroup", CGRect(x: 0, y: 100, width: 1700, height: 2000))
        ]
        let block = BrowserPageCapability.blockFrame(element: heading, ancestors: ancestors, page: page)
        #expect(block.width > 900 && block.width < 920 && block.height > 220 && block.height < 240)
        let bare = BrowserPageCapability.blockFrame(element: heading, ancestors: [ancestors[2]], page: page)
        #expect(bare.contains(heading) && bare.height < 60)
        let section = BrowserPageCapability.section(below: heading, page: page)
        #expect(section.minY < heading.minY - 200 && section.maxY > heading.maxY && page.contains(section))
    }

    @Test func tourPicksTheTitleAndKnowsWhereATargetSits() {
        let headings: [(label: String, frame: CGRect)] = [
            ("Inhalt", CGRect(x: 1100, y: 600, width: 500, height: 36)),
            ("Pflegegeld", CGRect(x: 130, y: 560, width: 280, height: 70))
        ]
        #expect(BrowserPageCapability.mainHeading(headings) == 1)
        let page = CGRect(x: 0, y: 100, width: 1700, height: 900)
        #expect(BrowserPageCapability.inBand(CGRect(x: 0, y: 700, width: 100, height: 30), page: page, from: 0.1, to: 0.5))
        #expect(BrowserPageCapability.inBand(CGRect(x: 0, y: 100, width: 100, height: 0), page: page, from: 0.1, to: 0.5) == false)
    }

    @Test func tourPaceDefaultsToSteps() {
        #expect(BrowserPageCapability.TourPace(hint: nil) == .step)
        #expect(BrowserPageCapability.TourPace(hint: "fast") == .fast)
        #expect(BrowserPageCapability.TourPace(hint: "highlight") == .step)
    }
}
