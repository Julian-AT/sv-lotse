import Foundation
import WebKit

@MainActor
public protocol DocumentUploading {
    var origin: String { get }
    func sessionID() async -> String?
    func upload(_ record: QueuedUpload) async throws
}

@MainActor
public final class DocumentUploadClient: DocumentUploading {
    public let origin: String
    private let endpoint: URL
    private let cookies: WKHTTPCookieStore
    private let session: URLSession

    public init(workspaceURL: URL, cookies: WKHTTPCookieStore) throws {
        guard var components = URLComponents(url: workspaceURL, resolvingAgainstBaseURL: false),
            let scheme = components.scheme, let host = components.host,
            scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)),
            components.user == nil, components.password == nil
        else { throw DocumentImportError.uploadRejected }
        components.path = ""
        components.query = nil
        components.fragment = nil
        guard let base = components.url else { throw DocumentImportError.uploadRejected }
        origin = base.absoluteString
        endpoint = base.appendingPathComponent(ImportConfiguration.endpointPath)
        self.cookies = cookies
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = ImportConfiguration.requestTimeout
        session = URLSession(configuration: configuration, delegate: NoUploadRedirects(), delegateQueue: nil)
    }

    private func sessionCookie() async -> HTTPCookie? {
        let expectedName = endpoint.scheme == "https" ? "__Host-lotse_session" : "lotse_session"
        let candidates = await cookies.allCookies().filter {
            $0.name == expectedName && $0.domain.lowercased() == endpoint.host?.lowercased()
                && $0.path == "/" && ($0.expiresDate.map { $0 > Date() } ?? true)
                && ($0.isSecure == false || endpoint.scheme == "https")
        }
        return candidates.count == 1 ? candidates.first : nil
    }

    public func sessionID() async -> String? {
        guard let cookie = await sessionCookie() else { return nil }
        return Self.sessionIdentifier(cookie.value)
    }

    nonisolated static func sessionIdentifier(_ value: String) -> String? {
        guard let body = value.split(separator: ".").first else { return nil }
        var encoded = String(body).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        struct CookieIdentity: Decodable { let sessionId: UUID }
        guard let data = Data(base64Encoded: encoded), let identity = try? JSONDecoder().decode(CookieIdentity.self, from: data) else {
            return nil
        }
        return identity.sessionId.uuidString.lowercased()
    }

    public func upload(_ record: QueuedUpload) async throws {
        guard record.workspaceOrigin == origin else { throw DocumentImportError.sessionChanged }
        guard let cookie = await sessionCookie(), let currentID = Self.sessionIdentifier(cookie.value) else {
            throw DocumentImportError.sessionRequired
        }
        guard record.sessionID == currentID else { throw DocumentImportError.sessionChanged }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(record.payload.mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(cookie.name + "=" + cookie.value, forHTTPHeaderField: "Cookie")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue(record.id.uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = record.payload.data
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw DocumentImportError.unavailable }
        try UploadAcknowledgement.validate(data: data, status: http.statusCode, uploadID: record.id)
    }
}

private final class NoUploadRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
