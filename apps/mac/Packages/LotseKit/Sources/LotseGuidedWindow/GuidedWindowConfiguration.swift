import Foundation
import WebKit

public enum GuidedOriginError: Error { case invalidOrigin }

public struct GuidedOriginPolicy: Sendable {
    public let origins: Set<String>

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

    /// Blob downloads inherit their creator's HTTPS origin. Blob navigation is never allowed.
    public func allowsDownload(_ address: String) -> Bool {
        if address.hasPrefix("blob:") { return allows(String(address.dropFirst(5))) }
        return allows(address)
    }

    private static func origin(_ address: String) -> String? {
        guard let url = URL(string: address), url.scheme?.lowercased() == "https",
            let host = url.host?.lowercased(), host.isEmpty == false,
            url.user == nil, url.password == nil
        else { return nil }
        // Serialize like the web's URL.origin (default port omitted); the guide runtime matches exactly.
        guard let port = url.port, port != 443 else { return "https://\(host)" }
        return "https://\(host):\(port)"
    }
}

@MainActor
public enum GuidedWindowConfiguration {
    public nonisolated static let maximumGuideBytes = 512 * 1024
    public static let contentWorldName = "dev.svkilotse.guide"
    public static let initialSize = CGSize(width: 1100, height: 760)
    public static let contentWorld = WKContentWorld.world(name: contentWorldName)
    public static func make() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = WKUserContentController()
        configuration.preferences.inactiveSchedulingPolicy = .none
        return configuration
    }

    public static func make(guideSource: String) -> WKWebViewConfiguration {
        let configuration = make()
        configuration.userContentController.addUserScript(WKUserScript(
            source: guideSource, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: contentWorld
        ))
        return configuration
    }
}
