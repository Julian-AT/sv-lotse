import Foundation
import Observation
import os

/// Which speech provider actually served the last voice turn, and why ElevenLabs was skipped.
/// Every turn tries ElevenLabs first again, so a fallback is never sticky for the session.
@MainActor @Observable
public final class VoiceProviderStatus {
    public enum Provider: Sendable { case unknown, elevenLabs, apple }

    public static let shared = VoiceProviderStatus()
    public private(set) var provider: Provider = .unknown
    /// Technical reason for the last fallback; never contains tokens or secrets.
    public private(set) var reason: String?
    public private(set) var updatedAt: Date?
    @ObservationIgnored private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    public init() {}

    public func usingElevenLabs() {
        if provider != .elevenLabs { log.notice("Voice provider: ElevenLabs") }
        provider = .elevenLabs
        reason = nil
        updatedAt = .now
    }

    public func fellBack(_ error: Error) {
        let reason = Self.describe(error)
        log.error("Voice provider fell back to Apple: \(reason, privacy: .public)")
        provider = .apple
        self.reason = reason
        updatedAt = .now
    }

    public nonisolated static func describe(_ error: Error) -> String {
        if let described = (error as? LocalizedError)?.errorDescription { return described }
        if let url = error as? URLError {
            return "WebSocket-Fehler \(url.code.rawValue): \(url.localizedDescription)"
        }
        switch error {
        case VoiceServiceError.unavailable: return "ElevenLabs hat die Verbindung abgelehnt"
        case VoiceServiceError.invalidResponse: return "Token-Antwort unvollständig (Token, Stimme oder Modell fehlt)"
        case VoiceServiceError.invalidAudio: return "ElevenLabs lieferte kein abspielbares Audio"
        case is DecodingError: return "Token-Antwort nicht lesbar"
        default:
            let nsError = error as NSError
            return "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
        }
    }
}

/// An `error` event from the ElevenLabs websocket, carried with its message.
public struct VoiceProviderError: LocalizedError {
    public let message: String
    public var errorDescription: String? { "ElevenLabs-WebSocket meldete: \(message)" }
}
