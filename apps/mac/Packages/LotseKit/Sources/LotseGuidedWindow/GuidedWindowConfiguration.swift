import Foundation
import WebKit

public enum GuidedOriginError: Error { case invalidOrigin }

public struct GuidedOriginPolicy: Sendable {
    private let origins: Set<String>

    public init(origins: [String]) throws {
        self.origins = try Set(
            origins.map {
                guard let origin = Self.origin($0) else { throw GuidedOriginError.invalidOrigin }
                return origin
            })
    }

    public func allows(_ address: String) -> Bool {
        guard let origin = Self.origin(address) else { return false }
        return origins.contains(origin)
    }

    private static func origin(_ address: String) -> String? {
        guard let url = URL(string: address), url.scheme?.lowercased() == "https",
            let host = url.host?.lowercased(), host.isEmpty == false,
            url.user == nil, url.password == nil
        else { return nil }
        return "https://\(host):\(url.port ?? 443)"
    }
}

@MainActor
public enum GuidedWindowConfiguration {
    /// Portal configurations must never share the workspace's controller or persistent data store.
    public static func make() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = WKUserContentController()
        return configuration
    }
}
