import AppKit
import Foundation
import LotseProtocol
import WebKit

extension WorkspaceWindowController {
    /// Fetch runs in the trusted workspace so its HttpOnly session cookie stays in the WebKit store.
    public func requestVoiceToken(type: String, language: String) async throws -> Data {
        guard isReady, let before = webView.url, try WorkspaceOrigin(url: before) == configuration.origin
        else { throw WorkspaceError.notReady }
        let connectionID = connectionID
        let result: Any?
        do {
            result = try await webView.callAsyncJavaScript(
            """
            const response = await fetch('/api/voice/token', {
                method: 'POST', credentials: 'same-origin', cache: 'no-store',
                redirect: 'error', signal: AbortSignal.timeout(timeout),
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({type, language})
            });
            if (!response.ok) {
                let code = '';
                try { const body = await response.json(); code = String(body.code || body.error || ''); } catch {}
                throw new Error('VOICE_TOKEN_HTTP ' + response.status + ' ' + code.slice(0, 80));
            }
            return await response.text();
            """,
            arguments: ["type": type, "language": language,
                        "timeout": WorkspaceSetupConfiguration.requestTimeoutMilliseconds], in: nil, contentWorld: .page
            )
        } catch {
            throw VoiceTokenRouteError(javaScriptError: error)
        }
        try Task.checkCancellation()
        guard isReady, self.connectionID == connectionID, webView.url == before,
              let json = result as? String else { throw WorkspaceError.notReady }
        return Data(json.utf8)
    }

    public func voiceContextCapsule() async throws -> ContextCapsule {
        guard isReady, NSApp.isActive, window?.isVisible == true,
            let url = webView.url, try WorkspaceOrigin(url: url) == configuration.origin
        else { return ContextCapsule(focusedRegion: nil, page: nil, screen: nil) }
        let result = try await webView.callAsyncJavaScript(
            """
            const unit = value => Math.min(1, Math.max(0, value));
            const handles = Array.from(document.querySelectorAll('[data-lotse-id]')).flatMap(element => {
                if (element.closest('input[type=password], [data-private]')) return [];
                const rect = element.getBoundingClientRect();
                if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0 || rect.top >= innerHeight) return [];
                return [{id: element.getAttribute('data-lotse-id'), role: element.getAttribute('role') || element.tagName.toLowerCase(),
                    label: element.getAttribute('aria-label') || element.textContent || '', value: '',
                    bbox: {x: unit(rect.x / innerWidth), y: unit(rect.y / innerHeight),
                        width: unit(rect.width / innerWidth), height: unit(rect.height / innerHeight)}}];
            });
            return JSON.stringify({page: {url: location.href, handles}});
            """, arguments: [:], in: nil, contentWorld: .page
        )
        guard webView.url == url, let json = result as? String else { throw WorkspaceError.notReady }
        return try JSONDecoder().decode(ContextCapsule.self, from: Data(json.utf8))
    }
}

/// Why `/api/voice/token` did not return a token, for the voice status and the log. Never carries the token.
public struct VoiceTokenRouteError: LocalizedError, Equatable {
    public let status: Int?
    public let code: String

    public init(status: Int?, code: String) {
        self.status = status
        self.code = code
    }

    init(javaScriptError error: Error) {
        let message = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
        self.init(message: message)
    }

    init(message: String) {
        guard let range = message.range(of: "VOICE_TOKEN_HTTP ") else {
            self.init(status: nil, code: String(message.prefix(120)))
            return
        }
        let parts = message[range.upperBound...].split(separator: " ", maxSplits: 1)
        self.init(status: parts.first.flatMap { Int($0) }, code: parts.count > 1 ? String(parts[1]) : "")
    }

    public var errorDescription: String? {
        guard let status else { return "Token-Route /api/voice/token nicht erreichbar: \(code)" }
        return "Token-Route /api/voice/token antwortete HTTP \(status)" + (code.isEmpty ? "" : " (\(code))")
    }
}

extension WorkspaceError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .notReady: "Arbeitsbereich nicht erreichbar oder noch nicht geladen"
        case .invalidURL: "Arbeitsbereich-Adresse ungültig"
        case .untrustedOrigin: "Arbeitsbereich-Herkunft nicht vertrauenswürdig"
        case .invalidEnvelope: "Ungültige Nachricht vom Arbeitsbereich"
        case .unsupportedMessage: "Nachricht vom Arbeitsbereich nicht unterstützt"
        }
    }
}
