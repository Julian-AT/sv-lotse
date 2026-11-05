import Foundation

public struct SharingConsent: Sendable {
    private var expiresAt: Date?

    public init() {}

    public mutating func approve(until expiry: Date) { expiresAt = expiry }
    public mutating func pause() { expiresAt = nil }

    public func canShare(at date: Date = Date()) -> Bool {
        guard let expiresAt else { return false }
        return date < expiresAt
    }
}
