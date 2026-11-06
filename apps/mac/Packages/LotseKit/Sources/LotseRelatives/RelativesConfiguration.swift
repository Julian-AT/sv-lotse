import Foundation

public enum RelativesConfiguration {
    public static let tokenPath = "/api/relatives/token"
    public static let workspacePath = "/api/workspace"
    public static let eventTopic = "lotse.relatives.pointer.v1"
    public static let consentDuration: TimeInterval = 15 * 60
    public static let framesPerSecond = 15
    public static let maximumDimension = 1920
    public static let maximumEventBytes = 16_384
    public static let maximumAnnotationPoints = 256
    public static let maximumAnnotations = 32
    public static let maximumLabelScalars = 64
    public static let helperIdentityPrefix = "helper:"
    public static let requestTimeoutMilliseconds = 15_000

    public static func excludedApplications(environment: [String: String] = ProcessInfo.processInfo.environment) -> Set<String> {
        Set((environment["LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS"] ?? "").split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { $0.isEmpty == false })
    }
}

public enum RelativesError: Error, Equatable {
    case consentRequired, invalidCredentials, workspaceUnavailable, noDisplay, captureFailed, recordingNotAllowed
}

public struct RelativesCredentials: Decodable, Sendable {
    public let serverUrl: URL
    public let participantToken: String
    public let expiresAt: Date

    public init(serverUrl: URL, participantToken: String, expiresAt: Date) throws {
        let local = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(serverUrl.host ?? "")
        guard serverUrl.scheme == "wss" || (serverUrl.scheme == "ws" && local),
              serverUrl.host?.isEmpty == false, serverUrl.user == nil, serverUrl.password == nil,
              participantToken.isEmpty == false, expiresAt > Date()
        else { throw RelativesError.invalidCredentials }
        self.serverUrl = serverUrl
        self.participantToken = participantToken
        self.expiresAt = expiresAt
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            serverUrl: values.decode(URL.self, forKey: .serverUrl),
            participantToken: values.decode(String.self, forKey: .participantToken),
            expiresAt: Self.expiration(from: values.decode(String.self, forKey: .expiresAt))
        )
    }

    private static func expiration(from value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: value) else { throw RelativesError.invalidCredentials }
        return date
    }

    private enum CodingKeys: String, CodingKey { case serverUrl, participantToken, expiresAt }
}
