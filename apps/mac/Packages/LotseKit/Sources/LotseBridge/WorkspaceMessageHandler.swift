import Foundation
import LotseProtocol
import WebKit

@MainActor
final class WorkspaceMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    let origin: WorkspaceOrigin
    var receive: ((BridgeToNative) throws -> Void)?

    init(origin: WorkspaceOrigin) { self.origin = origin }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        let securityOrigin = message.frameInfo.securityOrigin
        guard message.name == "lotse", message.frameInfo.isMainFrame,
            origin.matches(scheme: securityOrigin.protocol, host: securityOrigin.host, port: securityOrigin.port)
        else {
            replyHandler(nil, "untrusted_origin")
            return
        }
        do {
            guard JSONSerialization.isValidJSONObject(message.body) else { throw WorkspaceError.invalidEnvelope }
            let data = try JSONSerialization.data(withJSONObject: message.body)
            let envelope = try JSONDecoder().decode(BridgeToNative.self, from: data)
            guard let receive else { throw WorkspaceError.unsupportedMessage }
            try receive(envelope)
            replyHandler(["accepted": true], nil)
        } catch WorkspaceError.unsupportedMessage {
            replyHandler(nil, "unsupported_message")
        } catch {
            replyHandler(nil, "invalid_envelope")
        }
    }
}
