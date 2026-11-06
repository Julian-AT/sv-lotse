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
        try await wait { messages.count == 1 && controller.isReady }
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
        var accepted = 0
        controller.onMessage = { _ in accepted += 1 }
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
        #expect(accepted == 1) // Only the valid hello acknowledgement reached the native capability.
    }

    @Test("NFR-10 generated inbound validation rejects an empty id or a negative sentence index", arguments: [false, true])
    func invalidConstraints(negativeIndex: Bool) async throws {
        let (server, controller) = try await makeWorkspace()
        defer { server.stop() }
        var accepted = 0
        controller.onMessage = { _ in accepted += 1 }
        controller.load()
        try await wait { controller.isReady }
        let envelope = BridgeToNative.action(.init(
            id: negativeIndex ? "negative-index" : "",
            payload: .caption(.init(
                id: "caption-test", kind: .caption, payload: .init(label: "Arbeitsbereich", style: nil),
                sentenceIndex: negativeIndex ? -1 : 0, target: .ui(.init(elementID: "workspace", kind: .ui))
            )),
            type: .action, v: .the100
        ))
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope))
        let result = try await controller.webView.callAsyncJavaScript(
            """
            try {
              await window.webkit.messageHandlers.lotse.postMessage(message);
              return 'accepted';
            } catch (error) { return error.message; }
            """,
            arguments: ["message": object], in: nil, contentWorld: .page
        )
        #expect((result as? String)?.contains("invalid_envelope") == true)
        #expect(accepted == 1)
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

    @Test("NFR-10 BridgeHello waits for a receiver installed after page load and gates other messages")
    func lateReceiver() async throws {
        let (server, controller) = try await makeWorkspace(lateReceiver: true)
        defer { server.stop() }
        controller.onMessage = { _ in }
        controller.load()
        try await wait { controller.webView.isLoading == false && controller.webView.url != nil }
        #expect(controller.isReady == false)
        let transcript = BridgeToWorkspace.transcript(.init(
            id: "premature", payload: .init(capsule: nil, language: "de-AT", text: "Bitte öffnen", transcriptFinal: true),
            type: .transcript, v: .the100
        ))
        do {
            try await controller.send(transcript)
            Issue.record("Messages must be refused before hello succeeds")
        } catch WorkspaceError.notReady { }
        _ = try await controller.webView.callAsyncJavaScript(
            """
            window.installReceiver();
            const receive = window.__lotse.receive.bind(window.__lotse);
            return await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('hello timeout')), 5000);
              window.__lotse.receive = async message => {
                await new Promise(complete => {
                  window.completeHello = complete;
                  clearTimeout(timer);
                  resolve(true);
                });
                return await receive(message);
              };
            });
            """,
            arguments: [:], in: nil, contentWorld: .page
        )
        #expect(controller.isReady == false)
        do {
            try await controller.send(transcript)
            Issue.record("Messages must be refused while hello is still pending")
        } catch WorkspaceError.notReady { }
        _ = try await controller.webView.callAsyncJavaScript(
            "window.completeHello(); return true", arguments: [:], in: nil, contentWorld: .page
        )
        try await wait { controller.isReady }
        let types = try await controller.webView.callAsyncJavaScript(
            "return window.received.map(message => message.type)", arguments: [:], in: nil, contentWorld: .page
        )
        #expect(types as? [String] == ["BridgeHello"])
        #expect(controller.loadError == nil)
    }

    @Test("NFR-10 waiting for a missing receiver times out and a reload can recover")
    func receiverTimeout() async throws {
        let (server, controller) = try await makeWorkspace(lateReceiver: true, receiverTimeout: .seconds(1))
        defer { server.stop() }
        controller.onMessage = { _ in }
        controller.load()
        try await wait { controller.loadError != nil }
        #expect(controller.isReady == false)
        controller.webView.load(URLRequest(url: try server.url))
        try await wait { controller.isReady }
        #expect(controller.loadError == nil)
    }

    @Test("NFR-10 a new navigation cancels the old hello without changing the new navigation state")
    func navigationCancelsHello() async throws {
        let (server, controller) = try await makeWorkspace(lateReceiver: true, receiverTimeout: .seconds(1))
        defer { server.stop() }
        controller.onMessage = { _ in }
        controller.load()
        try await wait { controller.webView.isLoading == false && controller.webView.url != nil }
        controller.webView.load(URLRequest(url: try server.url))
        try await wait { controller.isReady }
        try await Task.sleep(for: .milliseconds(1200))
        #expect(controller.isReady)
        #expect(controller.loadError == nil)
        let count = try await controller.webView.callAsyncJavaScript(
            "return window.received.length", arguments: [:], in: nil, contentWorld: .page
        )
        #expect(count as? Int == 1)
    }

    private var testHello: BridgeHello {
        BridgeHello(
            appVersion: "test",
            capabilities: .init(accessibility: false, ocr: false, onDeviceContextSize: 0, onDeviceModel: false, overlay: true),
            protocolVersion: .the100
        )
    }

    func makeWorkspace(
        lateReceiver: Bool = false, receiverTimeout: Duration = .seconds(5)
    ) async throws -> (HTTPFixtureServer, WorkspaceWindowController) {
        _ = NSApplication.shared
        let server = try HTTPFixtureServer()
        try await wait { server.port != 0 }
        var components = URLComponents(url: try server.url, resolvingAgainstBaseURL: false)
        if lateReceiver { components?.queryItems = [URLQueryItem(name: "late", value: "1")] }
        let url = try #require(components?.url)
        let configuration = try WorkspaceConfiguration(url: url, dataStoreIdentifier: UUID())
        let controller = WorkspaceWindowController(
            configuration: configuration,
            hello: testHello, receiverTimeout: receiverTimeout
        )
        return (server, controller)
    }

    func wait(until condition: () -> Bool) async throws {
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

@Test("Voice token route errors keep the HTTP status and code for the voice status")
func voiceTokenRouteError() {
    let error = VoiceTokenRouteError(message: "Error: VOICE_TOKEN_HTTP 503 VOICE_NOT_CONFIGURED")
    #expect(error.status == 503)
    #expect(error.code == "VOICE_NOT_CONFIGURED")
    #expect(error.errorDescription?.contains("HTTP 503") == true)
    #expect(VoiceTokenRouteError(message: "TypeError: Load failed").status == nil)
}
