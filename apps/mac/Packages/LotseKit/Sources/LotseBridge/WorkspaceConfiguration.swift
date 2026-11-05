import Foundation

public enum WorkspaceError: Error {
    case invalidURL, untrustedOrigin, invalidEnvelope, notReady, unsupportedMessage
}

public struct WorkspaceOrigin: Equatable, Sendable {
    public let scheme: String
    public let host: String
    public let port: Int

    public init(url: URL) throws {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
            let host = url.host?.lowercased(), host.isEmpty == false,
            url.user == nil, url.password == nil
        else { throw WorkspaceError.invalidURL }
        self.scheme = scheme
        self.host = host
        self.port = url.port ?? (scheme == "https" ? 443 : 80)
    }

    public func matches(scheme: String, host: String, port: Int) -> Bool {
        let normalizedPort = port == 0 ? (scheme.lowercased() == "https" ? 443 : 80) : port
        return self.scheme == scheme.lowercased() && self.host == host.lowercased() && self.port == normalizedPort
    }
}

public struct WorkspaceConfiguration: Sendable {
    public let url: URL
    public let origin: WorkspaceOrigin
    public let dataStoreIdentifier: UUID

    public init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        info: [String: String] = [:]
    ) throws {
        let value = environment["LOTSE_WORKSPACE_URL"] ?? info["LOTSE_WORKSPACE_URL"] ?? "http://localhost:3000"
        guard let url = URL(string: value) else { throw WorkspaceError.invalidURL }
        try self.init(url: url)
    }

    public init(
        url: URL,
        dataStoreIdentifier: UUID = UUID(
            uuid: (
                0x38, 0xC5, 0xE4, 0xBE, 0x76, 0xE4, 0x4F, 0xAA,
                0xA3, 0x0F, 0xD6, 0x55, 0xE3, 0x46, 0xC4, 0x22
            ))
    ) throws {
        self.origin = try WorkspaceOrigin(url: url)
        self.url = url
        self.dataStoreIdentifier = dataStoreIdentifier
    }
}
