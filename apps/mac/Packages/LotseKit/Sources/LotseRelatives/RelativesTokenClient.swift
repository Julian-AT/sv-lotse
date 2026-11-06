import Foundation
import LotseBridge
import WebKit

public struct ShareableCase: Decodable, Identifiable, Sendable {
    public let id: UUID
    public let title: String
    public let subjectName: String
}

@MainActor
public final class RelativesTokenClient {
    private let webView: WKWebView
    private let origin: WorkspaceOrigin

    public init(webView: WKWebView, origin: WorkspaceOrigin) {
        self.webView = webView
        self.origin = origin
    }

    public func cases() async throws -> [ShareableCase] {
        struct Snapshot: Decodable { let cases: [ShareableCase] }
        return try await fetch(path: RelativesConfiguration.workspacePath, body: nil, as: Snapshot.self).cases
    }

    public func credentials(caseID: UUID) async throws -> RelativesCredentials {
        try await fetch(
            path: RelativesConfiguration.tokenPath,
            body: ["caseId": caseID.uuidString.lowercased(), "consent": true], as: RelativesCredentials.self
        )
    }

    private func fetch<Value: Decodable>(path: String, body: [String: Any]?, as type: Value.Type) async throws -> Value {
        try validateOrigin()
        // Fetch inside the persistent workspace reuses its HttpOnly session cookie without copying credentials.
        let result = try await webView.callAsyncJavaScript("""
            const response = await fetch(path, {
                method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                signal: AbortSignal.timeout(timeout),
                headers: body ? {'Content-Type': 'application/json'} : {},
                ...(body ? {body: JSON.stringify(body)} : {})
            });
            if (!response.ok) throw new Error('RELATIVES_UNAVAILABLE');
            return await response.text();
            """, arguments: ["path": path, "body": body.map { $0 as Any } ?? NSNull(),
                             "timeout": RelativesConfiguration.requestTimeoutMilliseconds], in: nil, contentWorld: .page)
        try Task.checkCancellation()
        try validateOrigin()
        guard let text = result as? String, let data = text.data(using: .utf8) else { throw RelativesError.workspaceUnavailable }
        let decoder = JSONDecoder()
        do { return try decoder.decode(type, from: data) } catch { throw RelativesError.workspaceUnavailable }
    }

    private func validateOrigin() throws {
        guard let url = webView.url, (try? WorkspaceOrigin(url: url)) == origin else { throw RelativesError.workspaceUnavailable }
    }
}
