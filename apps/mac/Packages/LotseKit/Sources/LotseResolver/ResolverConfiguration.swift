import Foundation
import LotseProtocol

public enum ResolverConfiguration {
    public static let minimumConfidence = 0.8
    public static let maximumAXNodes = 1500
    public static let axTraversalBudget: TimeInterval = 0.4
    public static let axMessagingTimeout: Float = 0.15
    public static let rectangleLifetime: TimeInterval = 3
    public static let screenLifetime: TimeInterval = 15
    public static let recognitionLanguages = ["de-DE", "en-US"]
    public static let resolvePath = "/api/resolve"

    public static func captureExclusions(environment: [String: String] = ProcessInfo.processInfo.environment) -> Set<String>? {
        guard let value = environment["LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS"] else { return nil }
        let identifiers = value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard identifiers.isEmpty == false,
            identifiers.allSatisfy({ $0.contains(".") && $0.contains(" ") == false && $0.isEmpty == false })
        else { return nil }
        return Set(identifiers)
    }
}

public struct ResolvedTarget: Sendable, Equatable {
    public let rect: CGRect
    public let method: LotseProtocol.ResolvedBy
    public let confidence: Double

    public init(rect: CGRect, method: LotseProtocol.ResolvedBy, confidence: Double) {
        self.rect = rect
        self.method = method
        self.confidence = confidence
    }
}
