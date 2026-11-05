import AppKit
import Foundation
import LotseProtocol
import Testing
import WebKit

@testable import LotseBridge

@Suite(.serialized) @MainActor
struct BridgeTests {
    @Test("NFR-10 BridgeHello and Transcript round trip through the real WebKit bridge")
    func roundTrip() async throws {
        let (server, controller) = try await makeWorkspace()
        defer { server.stop() }
        var messages: [BridgeToNative] = []
        controller.onMessage = { messages.append($0) }
        controller.load()
        try await wait { messages.count == 1 }
        let transcript = BridgeToWorkspace.transcript(
            .init(
                id: "transcript-test",
                payload: Transcript(capsule: nil, language: "de-AT", text: "Bitte öffnen Sie das Formular.", transcriptFinal: true),
                type: .transcript, v: .the100
            ))
        try await controller.send(transcript)
        try #require(messages.count == 2)
        let data = try await controller.webView.callAsyncJavaScript(
            "return JSON.stringify(window.received)", arguments: [:], in: nil, contentWorld: .page
        )
        let json = try #require(data as? String)
        let received = try JSONDecoder().decode([BridgeToWorkspace].self, from: Data(json.utf8))
        try #require(received.count == 2)
        if case .bridgeHello(let hello) = received[0] {
            #expect(hello.payload.protocolVersion == .the100)
        } else {
            Issue.record("Workspace did not receive BridgeHello first")
        }
        #expect(received[1] == transcript)
        if case .speechControl(let echo) = messages[1] {
            #expect(echo.id == "transcript-test")
            #expect(echo.payload.segmentIndex == 1)
        } else {
            Issue.record("Workspace did not echo the transcript acknowledgement")
        }
        #expect(controller.webView.configuration.preferences.inactiveSchedulingPolicy == .none)
        controller.showWorkspace()
        #expect(controller.window?.isVisible == true)
        controller.window?.performClose(nil)
        #expect(controller.window?.isVisible == false)
        #expect(controller.webView.url == (try server.url))
        controller.showWorkspace()
        controller.close()
        #expect(controller.window?.isVisible == false)
        #expect(controller.webView.url == (try server.url))
    }

    @Test("NFR-10 invalid envelopes reject their JavaScript promise")
    func invalidEnvelope() async throws {
        let (server, controller) = try await makeWorkspace()
        defer { server.stop() }
        controller.onMessage = { _ in }
        controller.load()
        try await wait { controller.isReady }
        for envelope in [
            "{v:'1.0.0',id:'invalid',type:'Unknown',payload:{}}",
            "{v:'2.0.0',id:'invalid',type:'SpeechControl',payload:{stop:false,state:'idle',segmentIndex:0}}",
            "{v:'1.0.0',id:'invalid',type:'SpeechControl',payload:{stop:false,state:'idle',segmentIndex:0,extra:1}}"
        ] {
            let result = try await controller.webView.callAsyncJavaScript(
                "try { await window.webkit.messageHandlers.lotse.postMessage(\(envelope)); return false; } catch { return true; }",
                arguments: [:], in: nil, contentWorld: .page
            )
            #expect(result as? Bool == true)
        }
    }

    @Test("NFR-10 bridge rejects foreign origins and same-origin child frames")
    func frameIsolation() async throws {
        let (server, controller) = try await makeWorkspace()
        defer { server.stop() }
        var count = 0
        controller.onMessage = { _ in count += 1 }
        controller.load()
        try await wait { controller.isReady }
        for host in ["localhost", "127.0.0.1"] {
            let result = try await controller.webView.callAsyncJavaScript(
                """
                return await new Promise((resolve, reject) => {
                  const timer = setTimeout(() => reject(new Error('frame timeout')), 5000);
                  window.addEventListener('message', event => {
                    clearTimeout(timer); resolve(event.data);
                  }, {once: true});
                  const frame = document.createElement('iframe');
                  frame.src = frameURL; document.body.append(frame);
                });
                """,
                arguments: ["frameURL": "http://\(host):\(server.port)/echo.html"], in: nil, contentWorld: .page
            )
            #expect(result as? String == "rejected")
        }
        #expect(count == 1)
    }

    @Test("NFR-10 workspace URL validates configuration and normalizes origins")
    func configuration() throws {
        let config = try WorkspaceConfiguration(environment: [:], info: [:])
        #expect(config.url.absoluteString == "http://localhost:3000")
        let explicitPort = try #require(URL(string: "https://example.at:443/a"))
        let defaultPort = try #require(URL(string: "https://example.at/b"))
        #expect(try WorkspaceOrigin(url: explicitPort) == WorkspaceOrigin(url: defaultPort))
        #expect(throws: WorkspaceError.self) {
            try WorkspaceConfiguration(environment: ["LOTSE_WORKSPACE_URL": "file:///tmp"], info: [:])
        }
        #expect(
            try WorkspaceConfiguration(
                environment: ["LOTSE_WORKSPACE_URL": "https://env.example.at"],
                info: ["LOTSE_WORKSPACE_URL": "https://plist.example.at"]
            ).url.host == "env.example.at")
    }

    @Test("NFR-10 every message checks the real main-frame security origin")
    func mainFrameOrigin() async throws {
        let (server, controller) = try await makeWorkspace()
        defer { server.stop() }
        var count = 0
        controller.onMessage = { _ in count += 1 }
        controller.load()
        try await wait { controller.isReady }

        // Bypass navigation policy only in the test to exercise the handler's independent origin check.
        let observer = NavigationObserver()
        controller.webView.navigationDelegate = observer
        var foreign = URLComponents(url: try server.url, resolvingAgainstBaseURL: false)
        foreign?.host = "localhost"
        let url = try #require(foreign?.url)
        controller.webView.load(URLRequest(url: url))
        try await wait { observer.loaded }
        let result = try await controller.webView.callAsyncJavaScript(
            """
            try {
              await window.webkit.messageHandlers.lotse.postMessage({
                v: '1.0.0', id: 'foreign-main-frame', type: 'SpeechControl',
                payload: {stop: false, state: 'idle', segmentIndex: 0}
              });
              return 'accepted';
            } catch (error) { return error.message; }
            """,
            arguments: [:], in: nil, contentWorld: .page
        )
        #expect((result as? String)?.contains("untrusted_origin") == true)
        #expect(count == 1)
    }

    private func makeWorkspace() async throws -> (HTTPFixtureServer, WorkspaceWindowController) {
        _ = NSApplication.shared
        let server = try HTTPFixtureServer()
        try await wait { server.port != 0 }
        let configuration = try WorkspaceConfiguration(url: server.url, dataStoreIdentifier: UUID())
        let controller = WorkspaceWindowController(
            configuration: configuration,
            hello: BridgeHello(
                appVersion: "test",
                capabilities: .init(
                    accessibility: false, ocr: false, onDeviceContextSize: 0, onDeviceModel: false, overlay: true
                ), protocolVersion: .the100
            ))
        return (server, controller)
    }

    private func wait(until condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while condition() == false {
            guard ContinuousClock.now < deadline else { throw FixtureError.timeout }
            try await Task.sleep(for: .milliseconds(20))
        }
    }
}

@MainActor
private final class NavigationObserver: NSObject, WKNavigationDelegate {
    var loaded = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) { loaded = true }
}
