import CoreGraphics
import Foundation

public enum VoiceConfiguration {
    public static var dictationShortcut: PushToTalkShortcut {
        PushToTalkShortcut(modifiers: [.maskControl, .maskShift], keyCode: 2)
    }
    public static let pasteKeyCode: CGKeyCode = 9
    public static let pasteConsumptionDelay: Duration = .milliseconds(500)
    public static let scribeURL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
    public static let ttsURL = "wss://api.elevenlabs.io/v1/text-to-speech"
    public static let maximumKeyterms = 50
    public static let maximumKeytermCharacters = 20
    public static let scribeModel = "scribe_v2_realtime"
    public static let sampleRate = 24000.0
    public static let audioFormat = "pcm_24000"
    public static let inputBufferSize: UInt32 = 2048
    public static let connectionTimeout: Duration = .seconds(10)
    public static let finalTimeout: Duration = .seconds(2)
    /// A capture started from the chat's mic button sends itself after this long.
    public static let toggleCaptureLimit: Duration = .seconds(60)
    public static let segmentTimeout: Duration = .seconds(45)
    public static let speedChoices: [Double] = [0.5, 0.75, 1, 1.25, 1.5]
    public static let speedPreferenceKey = "speechSpeed"
    public static let minimumSpeed = 0.5
    public static let maximumSpeed = 1.5
}

public enum VoiceServiceError: Error { case unavailable, invalidResponse, invalidAudio }

public enum VoiceTokenKind: String, Codable, Sendable { case realtimeScribe = "realtime_scribe", ttsWebsocket = "tts_websocket" }
public struct VoiceToken: Decodable, Sendable {
    public let token: String
    public let voiceId: String?
    public let modelId: String?
    public let vocabulary: VoiceVocabulary?
}
public typealias VoiceTokenLoader = @MainActor (VoiceTokenKind, String) async throws -> VoiceToken

func sendVoiceMessage<Value: Encodable>(_ value: Value, to socket: URLSessionWebSocketTask) async throws {
    let data = try JSONEncoder().encode(value)
    guard let text = String(data: data, encoding: .utf8) else { throw VoiceServiceError.invalidResponse }
    try await socket.send(.string(text))
}
func receiveVoiceMessage<Value: Decodable>(_ type: Value.Type, from socket: URLSessionWebSocketTask) async throws -> Value {
    let data: Data
    switch try await socket.receive() {
    case .data(let bytes): data = bytes
    case .string(let text): data = Data(text.utf8)
    @unknown default: throw VoiceServiceError.invalidResponse
    }
    return try JSONDecoder().decode(type, from: data)
}
