import Foundation
import Testing

@testable import LotseBridge

struct CaseNavigationTests {
    private let id = UUID(uuidString: "EC127314-6699-4E69-95F1-BF4AB16B6635")!

    @Test func caseIDsCrossIntoTheWebAppLowerCase() throws {
        #expect(WorkspaceCaseNavigation.caseID(id) == "ec127314-6699-4e69-95f1-bf4ab16b6635")
        let url = try #require(WorkspaceCaseNavigation.url(for: id, base: URL(string: "http://localhost:3000")!))
        #expect(url.absoluteString == "http://localhost:3000/workspace?caseId=ec127314-6699-4e69-95f1-bf4ab16b6635")
        #expect(WorkspaceChromeResource.conversation(id).path == "/api/cases/ec127314-6699-4e69-95f1-bf4ab16b6635?view=dashboard")
    }

    @Test func aLoadedWorkspaceSwitchesCasesInPlaceInsteadOfReloading() {
        let workspace = URL(string: "http://localhost:3000/workspace?caseId=0741a9c8-d2ee-4e25-8b81-67d42b50bb75")!
        #expect(WorkspaceCaseNavigation.decision(current: workspace, ready: true) == .switchInPage)
        #expect(WorkspaceCaseNavigation.decision(current: URL(string: "http://localhost:3000/workspace")!, ready: true) == .switchInPage)
    }

    @Test func anUnreadyOrForeignPageGetsOneFullLoad() {
        let workspace = URL(string: "http://localhost:3000/workspace")!
        #expect(WorkspaceCaseNavigation.decision(current: workspace, ready: false) == .load)
        #expect(WorkspaceCaseNavigation.decision(current: nil, ready: true) == .load)
        #expect(WorkspaceCaseNavigation.decision(current: URL(string: "http://localhost:3000/workspace/helpers")!, ready: true) == .load)
    }
}
