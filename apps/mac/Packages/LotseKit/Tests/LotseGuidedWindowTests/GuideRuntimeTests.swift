import AppKit
import CryptoKit
import LotseImport
import LotseProtocol
import Testing
import WebKit

@testable import LotseGuidedWindow

@Suite(.serialized, .timeLimit(.minutes(1))) @MainActor
struct GuideRuntimeTests {
    @Test("FR-D7 bundled guide is hidden from the page and returns credential-free protocol snapshots")
    func isolatedRuntime() async throws {
        _ = NSApplication.shared
        let policy = try GuidedOriginPolicy(origins: ["https://portal.example.at"])
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = try EncryptedUploadQueue(directory: root, encryptionKey: SymmetricKey(size: .bits256))
        let controller = try GuidedWindowController(originPolicy: policy, queue: queue)
        let observer = GuideNavigationObserver()
        controller.webView.navigationDelegate = observer
        let url = try #require(URL(string: "https://portal.example.at/form"))
        try await observer.load(controller.webView, html: """
            <!doctype html><html><body>
            <label for="name">Name</label><input id="name" value="Alex">
            <label for="password">Password</label><input id="password" type="password" value="hidden-value">
            <button type="submit">Absenden</button>
            </body></html>
            """, baseURL: url)
        controller.webView(controller.webView, didFinish: nil)

        let hidden = try await controller.webView.callAsyncJavaScript(
            """
            return typeof window.__lotseGuide === 'undefined' && typeof window.__lotsePortal === 'undefined'
                && !window.webkit?.messageHandlers?.lotse;
            """,
            arguments: [:], in: nil, contentWorld: .page
        )
        #expect(hidden as? Bool == true)
        let page = try await controller.snapshot()
        #expect(page.url == url.absoluteString)
        #expect(page.handles.contains { $0.label == "Name" && $0.value == "Alex" })
        #expect(page.handles.contains { $0.label == "Password" } == false)
        let serialized = try #require(String(data: JSONEncoder().encode(page), encoding: .utf8))
        #expect(serialized.contains("hidden-value") == false)
        let handle = try #require(page.handles.first { $0.label == "Name" })
        let action = Action.highlight(.init(
            id: "highlight-name", kind: .highlight, payload: .init(label: nil, style: nil), sentenceIndex: 0,
            target: .dom(.init(handle: handle.id, kind: .dom, url: page.url))
        ))
        #expect(try await controller.execute([action]).first?.success == true)
        try await controller.clearOverlays()
        let visible = try await controller.webView.callAsyncJavaScript(
            "return typeof window.__lotsePortal;", arguments: [:], in: nil, contentWorld: .page
        )
        #expect(visible as? String == "undefined")
        controller.webViewWebContentProcessDidTerminate(controller.webView)
        await #expect(throws: GuidedWindowError.self) { try await controller.snapshot() }
    }

    @Test("FR-D7 portal typing refuses unapproved actions and approved fills for unknown fields")
    func serverVerifiedTyping() async throws {
        _ = NSApplication.shared
        let policy = try GuidedOriginPolicy(origins: ["https://portal.example.at"])
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let queue = try EncryptedUploadQueue(directory: root, encryptionKey: SymmetricKey(size: .bits256))
        let controller = try GuidedWindowController(originPolicy: policy, queue: queue)
        let observer = GuideNavigationObserver()
        controller.webView.navigationDelegate = observer
        let url = try #require(URL(string: "https://portal.example.at/form"))
        try await observer.load(controller.webView, html: """
            <!doctype html><html><body><label for="name">Name</label><input id="name" value=""></body></html>
            """, baseURL: url)
        controller.webView(controller.webView, didFinish: nil)
        let page = try await controller.snapshot()
        let handle = try #require(page.handles.first { $0.label == "Name" })
        let action = Action.type(.init(
            id: "fill-name", kind: .type,
            payload: .init(pace: 1, provenance: .init(factID: nil, source: .init(
                bbox: nil, documentID: nil, kind: .statement, page: nil, quote: "Alex", turnID: nil
            )), value: "Alex"),
            sentenceIndex: 0, target: .dom(.init(handle: handle.id, kind: .dom, url: page.url))
        ))
        await #expect(throws: GuidedWindowError.approvalRequired) { try await controller.execute([action]) }
        let readValue = "return document.getElementById('name').value;"
        let untouched = try await controller.webView.callAsyncJavaScript(readValue, arguments: [:], in: nil, contentWorld: .page)
        #expect(untouched as? String == "")
        // An approved fill is still bound to a labelled field on the current portal page.
        let foreign = Action.type(.init(
            id: "fill-other", kind: .type,
            payload: .init(pace: 1, provenance: .init(factID: nil, source: .init(
                bbox: nil, documentID: nil, kind: .statement, page: nil, quote: "Alex", turnID: nil
            )), value: "Alex"),
            sentenceIndex: 0, target: .dom(.init(handle: "missing-handle", kind: .dom, url: page.url))
        ))
        await #expect(throws: GuidedWindowError.unsupportedAction) {
            try await controller.fill(GuidedApprovedFill(approvalID: "approval", toolCallID: "fill-other", action: foreign))
        }
        let still = try await controller.webView.callAsyncJavaScript(readValue, arguments: [:], in: nil, contentWorld: .page)
        #expect(still as? String == "")
    }

    @Test("FR-D7 the shipped origin resource is HTTPS only and refuses foreign origins")
    func bundledAllowlist() throws {
        #expect(try GuidedWindowResources.guideSource().contains("createGuide"))
        let policy = try GuidedWindowResources.originPolicy()
        #expect(policy.origins.isEmpty == false)
        #expect(policy.origins.allSatisfy { $0.hasPrefix("https://") })
        #expect(policy.allows("https://foreign.example") == false)
    }
}

@MainActor
private final class GuideNavigationObserver: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?

    func load(_ webView: WKWebView, html: String, baseURL: URL) async throws {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            webView.loadHTMLString(html, baseURL: baseURL)
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
                self?.continuation?.resume(throwing: GuideFixtureError.timeout)
                self?.continuation = nil
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        continuation?.resume()
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

private enum GuideFixtureError: Error { case timeout }
