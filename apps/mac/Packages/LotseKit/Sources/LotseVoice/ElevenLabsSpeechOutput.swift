import Foundation
import LotseProtocol

@MainActor
final class ElevenLabsSpeechOutput {
    private let loadToken: VoiceTokenLoader
    private var pronunciationAliases: [VoiceAlias] = []
    private var socket: URLSessionWebSocketTask?
    private var turnID: String?
    private var voiceID: String?
    private var player: PCMStreamingPlayer?
    private(set) var didStart = false

    init(loadToken: @escaping VoiceTokenLoader) { self.loadToken = loadToken }

    func speak(_ segment: SpeechSegment, speed: Double, onStart: @escaping () -> Void) async throws {
        didStart = false
        let socket = try await connection(for: segment)
        try Task.checkCancellation()
        let player = try PCMStreamingPlayer(speed: speed)
        self.player = player
        player.onStart = { [weak self] in self?.didStart = true; onStart() }
        let context = UUID().uuidString
        let deadline = Task { @MainActor in
            do { try await Task.sleep(for: VoiceConfiguration.segmentTimeout) } catch { return }
            socket.cancel(with: .goingAway, reason: nil)
        }
        defer { deadline.cancel(); player.stop(); self.player = nil }
        try await sendVoiceMessage(TTSInitialize(contextID: context), to: socket)
        let text = VoiceVocabulary.replacing(segment.text, aliases: pronunciationAliases) + " "
        try await sendVoiceMessage(TTSText(text: text, contextID: context), to: socket)
        try await sendVoiceMessage(TTSFlush(contextID: context), to: socket)
        var receivedAudio = false
        while Task.isCancelled == false {
            let event = try await receiveVoiceMessage(TTSAudio.self, from: socket)
            if let message = event.error { throw VoiceProviderError(message: String(message.prefix(200))) }
            guard event.contextId == context || event.contextId == nil else { continue }
            if let audio = event.audio, audio.isEmpty == false {
                guard let data = Data(base64Encoded: audio) else { throw VoiceServiceError.invalidAudio }
                try player.append(data)
                receivedAudio = true
            }
            if event.isFinal == true {
                // An empty final frame is how the multi-context socket refuses a voice (e.g. a library voice
                // on the free tier); the single-context socket would have said so in an error message.
                guard receivedAudio else { throw VoiceProviderError(message: "leeres Audio für Stimme \(voiceID ?? "?")") }
                try await sendVoiceMessage(TTSCloseContext(contextID: context), to: socket)
                await player.finish()
                try Task.checkCancellation()
                return
            }
        }
        throw CancellationError()
    }

    func stop() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        turnID = nil
        player?.stop()
        player = nil
    }

    private func connection(for segment: SpeechSegment) async throws -> URLSessionWebSocketTask {
        if turnID == segment.turnID, let socket { return socket }
        stop()
        let language = segment.language.hasPrefix("en") ? "en" : "de"
        let token = try await loadToken(.ttsWebsocket, language)
        try Task.checkCancellation()
        guard let voice = token.voiceId, let model = token.modelId,
            var url = URLComponents(string: VoiceConfiguration.ttsURL)
        else { throw VoiceServiceError.unavailable }
        url.path += "/\(voice)/multi-stream-input"
        url.queryItems = [
            .init(name: "single_use_token", value: token.token), .init(name: "model_id", value: model),
            .init(name: "output_format", value: VoiceConfiguration.audioFormat)
        ]
        guard let address = url.url else { throw VoiceServiceError.unavailable }
        let socket = URLSession.shared.webSocketTask(with: address)
        socket.resume()
        self.socket = socket
        voiceID = voice
        pronunciationAliases = token.vocabulary?.pronunciationAliases ?? []
        turnID = segment.turnID
        return socket
    }
}
private struct TTSInitialize: Encodable {
    enum CodingKeys: String, CodingKey { case text, contextID = "context_id" }
    let text = " "
    let contextID: String
}
private struct TTSText: Encodable {
    enum CodingKeys: String, CodingKey { case text, contextID = "context_id" }
    let text: String
    let contextID: String
}
private struct TTSFlush: Encodable {
    enum CodingKeys: String, CodingKey { case contextID = "context_id", flush }
    let contextID: String
    let flush = true
}
private struct TTSCloseContext: Encodable {
    enum CodingKeys: String, CodingKey { case contextID = "context_id", closeContext = "close_context" }
    let contextID: String
    let closeContext = true
}
struct TTSAudio: Decodable {
    let audio: String?
    let contextId: String?
    let isFinal: Bool?
    let error: String?
}
