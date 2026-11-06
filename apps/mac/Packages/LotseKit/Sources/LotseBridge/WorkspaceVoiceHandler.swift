import Foundation
import WebKit

/// The chat's mic button inside the app: `window.webkit.messageHandlers.lotseVoice.postMessage("toggle")`.
/// It drives the same native capture as ⌥⌘ (Scribe, Clicky's bubble, one final transcript), so the page
/// never runs a second recorder. Replies with the capture state; changes arrive as `lotse:voice-state`.
@MainActor
final class WorkspaceVoiceHandler: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "lotseVoice"
    let origin: WorkspaceOrigin
    var command: ((WorkspaceVoiceCommand) -> Bool)?

    init(origin: WorkspaceOrigin) { self.origin = origin }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        let securityOrigin = message.frameInfo.securityOrigin
        guard message.name == Self.name, message.frameInfo.isMainFrame,
            origin.matches(scheme: securityOrigin.protocol, host: securityOrigin.host, port: securityOrigin.port)
        else {
            replyHandler(nil, "untrusted_origin")
            return
        }
        guard let body = message.body as? String, let parsed = WorkspaceVoiceCommand(rawValue: body), let command else {
            replyHandler(nil, "unsupported_message")
            return
        }
        replyHandler(["listening": command(parsed)], nil)
    }
}

public enum WorkspaceVoiceCommand: String, Sendable {
    case toggle, stop, state
}

extension WorkspaceWindowController {
    /// Tells the page whether the native capture is listening, for the mic button's pressed state.
    public func publishVoiceState(listening: Bool) {
        guard isReady else { return }
        webView.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('lotse:voice-state', {detail: {listening: \(listening)}}))",
            in: nil, in: .page, completionHandler: nil
        )
    }
}
