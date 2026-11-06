import CoreGraphics
import Foundation
@testable import LotseResolver
import Testing

struct FakeNode: BrowserAXNode {
    var role: String?
    var subrole: String?
    var title: String?
    var nodeDescription: String?
    var placeholder: String?
    var value: String?
    var url: String?
    var frame: CGRect? = CGRect(x: 0, y: 0, width: 100, height: 20)
    var children: [FakeNode] = []
}

private func page() -> FakeNode {
    FakeNode(role: "AXWebArea", title: "Pflegegeld beantragen", url: "https://www.sozialversicherung.at/pflegegeld",
        frame: CGRect(x: 0, y: 0, width: 1000, height: 800), children: [
            FakeNode(role: "AXHeading", children: [FakeNode(role: "AXStaticText", value: "Pflegegeld")]),
            FakeNode(role: "AXGroup", children: [
                FakeNode(role: "AXTextField", title: "Vorname", value: "Anna", frame: CGRect(x: 10, y: 600, width: 200, height: 24)),
                FakeNode(role: "AXTextField", subrole: "AXSecureTextField", title: "Passwort", value: "geheim"),
                FakeNode(role: "AXStaticText", value: "Antrag auf Pflegegeld stellen", frame: CGRect(x: 10, y: 400, width: 300, height: 18)),
                FakeNode(role: "AXButton", title: "Absenden"),
                FakeNode(role: "AXLink", children: [FakeNode(role: "AXStaticText", value: "Formular herunterladen")])
            ])
        ])
}

@Test func findsTheWebAreaBelowBrowserChrome() {
    let window = FakeNode(role: "AXWindow", children: [FakeNode(role: "AXToolbar"), FakeNode(role: "AXGroup", children: [page()])])
    #expect(BrowserPageReader.webArea(in: [window])?.title == "Pflegegeld beantragen")
    #expect(BrowserPageReader.webArea(in: [FakeNode(role: "AXWindow")]) == nil)
}

@Test func readsLabelledControlsAndSkipsPasswordFields() {
    let elements = BrowserPageReader.elements(in: page())
    #expect(elements.map(\.role) == ["heading", "textbox", "button", "link"])
    #expect(elements.map(\.label) == ["Pflegegeld", "Vorname", "Absenden", "Formular herunterladen"])
    #expect(elements[1].value == "Anna")
    #expect(elements.contains { $0.label == "Passwort" || $0.value == "geheim" } == false)
}

@Test func handleIDsAreStableAndDistinguishRepeats() {
    let first = BrowserPageReader.handleID(role: "textbox", label: "Vorname", occurrence: 0)
    #expect(first == BrowserPageReader.handleID(role: "textbox", label: "vorname", occurrence: 0))
    #expect(first != BrowserPageReader.handleID(role: "textbox", label: "Vorname", occurrence: 1))
    let elements = BrowserPageReader.elements(in: page())
    #expect(BrowserPageReader.element(handle: first, in: elements)?.label == "Vorname")
}

@Test func matchesVisibleQuotesCaseAndSpaceInsensitively() {
    let match = BrowserPageReader.textMatch("antrag auf  Pflegegeld", in: page())
    #expect(match?.1 == CGRect(x: 10, y: 400, width: 300, height: 18))
    #expect(BrowserPageReader.textMatch("geheim", in: page()) == nil)
}

@Test func boxesAreRelativeToThePageTopLeft() throws {
    let box = try #require(BrowserPageReader.boundingBox(CGRect(x: 100, y: 700, width: 100, height: 50),
        in: CGRect(x: 0, y: 0, width: 1000, height: 800)))
    #expect(box.minX == 0.1 && box.width == 0.1)
    #expect(abs(box.minY - 50.0 / 800) < 1e-9)
    #expect(BrowserPageReader.boundingBox(CGRect(x: 0, y: 900, width: 10, height: 10), in: CGRect(x: 0, y: 0, width: 1000, height: 800)) == nil)
}

@Test func denyListBlocksSubmitSendBuyInGermanAndEnglish() {
    for label in ["Absenden", "Antrag senden", "Jetzt kaufen", "Zahlungspflichtig bestellen", "Submit", "Buy now", "Log in"] {
        #expect(BrowserPageSafety.isDenied(role: "button", label: label), "\(label)")
    }
    #expect(BrowserPageSafety.isDenied(role: "button", label: "Weiter") == false)
    #expect(BrowserPageSafety.isDenied(role: "textbox", label: "Absender") == false)
    #expect(BrowserPageSafety.isFillable(role: "textbox"))
    #expect(BrowserPageSafety.isFillable(role: "button") == false)
}

@Test func loginPagesAreRefused() {
    #expect(BrowserPageSafety.isLoginPage("https://www.sozialversicherung.at/login"))
    #expect(BrowserPageSafety.isLoginPage("https://example.at/oauth2/authorize?x=1"))
    #expect(BrowserPageSafety.isLoginPage("https://example.at/id-austria"))
    #expect(BrowserPageSafety.isLoginPage("https://www.sozialversicherung.at/cdscontent/?contentid=10007.844") == false)
}

@Test func loginPatternsMatchTheKnowledgePolicy() throws {
    let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appending(path: "../../../../../../packages/knowledge/data/portal-login-pages.json").standardized
    let json = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    #expect(json?["url_patterns"] as? [String] == BrowserPageSafety.loginPatterns)
}

@Test func picksTheAcceptedWebAreaAndSkipsAssistantPanels() {
    let sidebar = FakeNode(role: "AXWebArea", url: "https://assistant.example/")
    let window = FakeNode(role: "AXWindow", children: [sidebar, page()])
    let area = BrowserPageReader.webArea(in: [window]) { $0.url?.hasPrefix("https://www.sozialversicherung.at") == true }
    #expect(area?.title == "Pflegegeld beantragen")
}

@Test func handlesFallBackToTheirLabelAndIconGlyphsAreDropped() {
    let elements = BrowserPageReader.elements(in: page())
    #expect(BrowserPageReader.element(handle: "ax-stale", label: "vorname", in: elements)?.role == "textbox")
    #expect(BrowserPageReader.element(handle: "ax-stale", in: elements) == nil)
    #expect(BrowserPageReader.clean("\u{E900} Alles auf einen Blick") == "Alles auf einen Blick")
}
