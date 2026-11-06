import Foundation
import WebKit

public enum WorkspaceChromeResource: Sendable {
    case cases, createCase, conversation(UUID), profile, health

    var path: String {
        switch self {
        case .cases: "/api/cases?view=dashboard"
        case .createCase: "/api/cases"
        case .conversation(let id): "/api/cases/\(WorkspaceCaseNavigation.caseID(id))?view=dashboard"
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

    /// Opens a conversation. A loaded workspace page switches in place through its client state, so the
    /// dashboard never re-navigates the web view (a reload would abort the page's own requests); only a
    /// page that is not ready or not the workspace route gets a full load.
    public func navigateToCase(_ id: UUID) {
        guard let url = WorkspaceCaseNavigation.url(for: id, base: configuration.url) else { return }
        switch WorkspaceCaseNavigation.decision(current: webView.url, ready: isReady) {
        case .load: resetAndLoad(url)
        case .switchInPage:
            let connection = connectionID
            Task { @MainActor [weak self] in
                guard let self else { return }
                let handled = try? await webView.callAsyncJavaScript(
                    "return typeof window.__lotseSelectCase === 'function' && window.__lotseSelectCase(id) === true",
                    arguments: ["id": WorkspaceCaseNavigation.caseID(id)], in: nil, contentWorld: .page
                )
                guard connectionID == connection else { return }
                if handled as? Bool != true { resetAndLoad(url) }
            }
        }
    }

    /// Opens the helper invitation view (invite link, admission requests) in the embedded web view.
    public func navigateToHelpers() {
        var components = URLComponents(url: configuration.url, resolvingAgainstBaseURL: false)
        components?.path = WorkspaceConfiguration.helpersPath
        components?.query = nil
        guard let url = components?.url else { return }
        resetAndLoad(url)
    }
}

/// How the dashboard opens a conversation in the embedded workspace. Case ids cross into the web app
/// lower-case (the API's form); `UUID.uuidString` is upper-case.
public enum WorkspaceCaseNavigation {
    public enum Decision: Equatable, Sendable { case switchInPage, load }

    public static func caseID(_ id: UUID) -> String { id.uuidString.lowercased() }

    public static func url(for id: UUID, base: URL) -> URL? {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        components?.path = WorkspaceConfiguration.workspacePath
        components?.queryItems = [URLQueryItem(name: "caseId", value: caseID(id))]
        return components?.url
    }

    public static func decision(current: URL?, ready: Bool) -> Decision {
        // Same-case selections also go to the page: it retries a conversation that failed to load.
        guard ready, let current, current.path == WorkspaceConfiguration.workspacePath else { return .load }
        return .switchInPage
    }
}
