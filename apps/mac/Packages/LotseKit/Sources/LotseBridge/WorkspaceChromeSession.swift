import Foundation
import WebKit

public enum WorkspaceChromeResource: Sendable {
    case cases, createCase, conversation(UUID), profile, health

    var path: String {
        switch self {
        case .cases: "/api/cases?view=dashboard"
        case .createCase: "/api/cases"
        case .conversation(let id): "/api/cases/\(id.uuidString)?view=dashboard"
        case .profile: "/api/profile"
        case .health: "/api/health"
        }
    }
}

extension WorkspaceWindowController {
    public func requestChrome(
        _ resource: WorkspaceChromeResource, method: String = "GET", body: String? = nil
    ) async throws -> Data {
        guard isReady, let before = webView.url, try WorkspaceOrigin(url: before) == configuration.origin
        else { throw WorkspaceError.notReady }
        let result = try await webView.callAsyncJavaScript(
            """
            const response = await fetch(path, {
                method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                headers: {'Content-Type': 'application/json'}, body: body || undefined
            });
            if (!response.ok && path !== '/api/health') throw new Error('CHROME_REQUEST_FAILED');
            return await response.text();
            """,
            arguments: ["path": resource.path, "method": method, "body": body ?? ""], in: nil, contentWorld: .page
        )
        try Task.checkCancellation()
        guard isReady, webView.url == before, let json = result as? String else { throw WorkspaceError.notReady }
        return Data(json.utf8)
    }

    public func navigateToCase(_ id: UUID) {
        var components = URLComponents(url: configuration.url, resolvingAgainstBaseURL: false)
        components?.path = "/workspace"
        components?.queryItems = [URLQueryItem(name: "caseId", value: id.uuidString)]
        guard let url = components?.url else { return }
        resetAndLoad(url)
    }
}
