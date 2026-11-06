import Foundation
import WebKit

public struct WorkspaceSetupDiagnostics: Equatable, Sendable {
    public let reachable: Bool
    public let sessionCookie: Bool
    public let bridgeAcknowledged: Bool

    public init(reachable: Bool, sessionCookie: Bool, bridgeAcknowledged: Bool) {
        self.reachable = reachable
        self.sessionCookie = sessionCookie
        self.bridgeAcknowledged = bridgeAcknowledged
    }
}

extension WorkspaceWindowController {
    public func checkSetupConnection() async throws -> WorkspaceSetupDiagnostics {
        guard let pageURL = webView.url, try WorkspaceOrigin(url: pageURL) == configuration.origin else {
            throw WorkspaceError.notReady
        }
        let connectionID = connectionID
        let result = try await webView.callAsyncJavaScript(
            """
            const options = {credentials: 'same-origin', cache: 'no-store', redirect: 'error'};
            let reachable = false;
            let session = false;
            try {
                const page = await fetch(workspaceURL, {...options, signal: AbortSignal.timeout(timeout)});
                reachable = page.ok;
                await page.body?.cancel();
                if (reachable) {
                    const response = await fetch('/api/session', {...options, signal: AbortSignal.timeout(timeout)});
                    if (response.ok) {
                        const identity = await response.json();
                        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                        session = identity.kind === 'anonymous' && uuid.test(identity.sessionId) && uuid.test(identity.userId);
                    }
                }
            } catch { /* Only aggregate readiness crosses the native boundary. */ }
            return {reachable, session};
            """,
            arguments: ["workspaceURL": configuration.workspaceURL.absoluteString,
                        "timeout": WorkspaceSetupConfiguration.requestTimeoutMilliseconds],
            in: nil, contentWorld: .page
        )
        try Task.checkCancellation()
        guard self.connectionID == connectionID, webView.url == pageURL,
              let values = result as? [String: Bool] else { throw WorkspaceError.notReady }
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        try Task.checkCancellation()
        guard self.connectionID == connectionID else { throw WorkspaceError.notReady }
        let cookiePresent = cookies.contains { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return WorkspaceSetupConfiguration.sessionCookieNames.contains(cookie.name)
                && cookie.isHTTPOnly && cookie.path == "/" && domain.lowercased() == configuration.origin.host
                && (cookie.expiresDate.map { $0 > Date() } ?? true)
                && (configuration.origin.scheme == "https" ? cookie.isSecure : true)
        }
        return WorkspaceSetupDiagnostics(
            reachable: values["reachable"] == true,
            sessionCookie: values["session"] == true && cookiePresent,
            bridgeAcknowledged: isReady
        )
    }
}
