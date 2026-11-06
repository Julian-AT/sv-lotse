import Foundation
import LotseProtocol
import os

@MainActor
final class ElevenLabsSpeechOutput {
    private let loadToken: VoiceTokenLoader
    private var pronunciationAliases: [VoiceAlias] = []
    private var socket: URLSessionWebSocketTask?
    private var turnID: String?
    private var voiceID: String?
    private var player: PCMStreamingPlayer?
    private var warm: Task<OpenedSocket?, Never>?
    private var warmLanguage: String?
    private(set) var didStart = false
    /// Stage timings of the last segment (token+socket, player, first audio), for the log and live tests.
    private(set) var lastTimings = ""
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    init(loadToken: @escaping VoiceTokenLoader) { self.loadToken = loadToken }

    func speak(_ segment: SpeechSegment, speed: Double, onStart: @escaping () -> Void) async throws {
        didStart = false
        let begin = ContinuousClock.now
        let elapsed = { ScribeRealtimeTranscriptionProvider.milliseconds(ContinuousClock.now - begin) }
        let socket = try await connection(for: segment)
        let connected = elapsed()
        try Task.checkCancellation()
        let player = try PCMStreamingPlayer(speed: speed)
        let prepared = elapsed()
        self.player = player
        player.onStart = { [weak self] in self?.didStart = true; onStart() }
        let context = UUID().uuidString
        let deadline = Task { @MainActor in
            do { try await Task.sleep(for: VoiceConfiguration.segmentTimeout) } catch { return }
            socket.cancel(with: .goingAway, reason: nil)
        }
        defer { deadline.cancel(); player.stop(); self.player = nil }
        // One message opens the context, carries the sentence and flushes it. A separate " " initializer
        // sent to a socket that idled while the brain was thinking is never answered.
        let text = VoiceVocabulary.replacing(segment.text, aliases: pronunciationAliases) + " "
        try await sendVoiceMessage(TTSText(text: text, contextID: context), to: socket)
        var receivedAudio = false
        while Task.isCancelled == false {
            let event = try await receiveVoiceMessage(TTSAudio.self, from: socket)
            if let message = event.error { throw VoiceProviderError(message: String(message.prefix(200))) }
            guard event.contextId == context || event.contextId == nil else { continue }
            if let audio = event.audio, audio.isEmpty == false {
                guard let data = Data(base64Encoded: audio) else { throw VoiceServiceError.invalidAudio }
                if receivedAudio == false {
                    lastTimings = "connection \(connected) ms, player \(prepared) ms, first audio \(elapsed()) ms"
                    log.info("TTS segment \(segment.index, privacy: .public): \(self.lastTimings, privacy: .public)")
                }
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

    /// Opens the next turn's TTS socket while the brain is still thinking, so the first sentence skips the
    /// token request and the TLS/WebSocket handshake (~0.3–0.9 s).
    func prewarm(language: String) {
        let language = Self.ttsLanguage(language)
        if warmLanguage == language, warm != nil { return }
        discardWarm()
        warmLanguage = language
        warm = Task { @MainActor [weak self] in try? await self?.open(language: language) }
    }

    func discardWarm() {
        let pending = warm
        warm = nil
        warmLanguage = nil
        Task { @MainActor in (await pending?.value)?.socket.cancel(with: .goingAway, reason: nil) }
    }

    private func connection(for segment: SpeechSegment) async throws -> URLSessionWebSocketTask {
        if turnID == segment.turnID, let socket { return socket }
        stop()
        let language = Self.ttsLanguage(segment.language)
        var opened: OpenedSocket?
        if warmLanguage == language, let pending = warm {
            warm = nil
            warmLanguage = nil
            if let ready = await pending.value {
                if ContinuousClock.now - ready.opened < VoiceConfiguration.warmSocketLifetime { opened = ready } else {
                    ready.socket.cancel(with: .goingAway, reason: nil)
                }
            }
        }
        let connection: OpenedSocket
        if let opened { connection = opened } else { connection = try await open(language: language) }
        try Task.checkCancellation()
        socket = connection.socket
        voiceID = connection.voice
        pronunciationAliases = connection.aliases
        turnID = segment.turnID
        return connection.socket
    }

    private func open(language: String) async throws -> OpenedSocket {
        let token = try await loadToken(.ttsWebsocket, language)
        guard let voice = token.voiceId, let model = token.modelId,
            var url = URLComponents(string: VoiceConfiguration.ttsURL)
        else { throw VoiceServiceError.unavailable }
        url.path += "/\(voice)/multi-stream-input"
        url.queryItems = [
            .init(name: "single_use_token", value: token.token), .init(name: "model_id", value: model),
            .init(name: "output_format", value: VoiceConfiguration.audioFormat),
            .init(name: "inactivity_timeout", value: String(VoiceConfiguration.ttsInactivityTimeoutSeconds))
        ]
        guard let address = url.url else { throw VoiceServiceError.unavailable }
        let socket = URLSession.shared.webSocketTask(with: address)
        socket.resume()
        return OpenedSocket(socket: socket, voice: voice, aliases: token.vocabulary?.pronunciationAliases ?? [], opened: .now)
    }

    nonisolated static func ttsLanguage(_ language: String) -> String { language.hasPrefix("en") ? "en" : "de" }
}

private struct OpenedSocket {
    let socket: URLSessionWebSocketTask
    let voice: String
    let aliases: [VoiceAlias]
    let opened: ContinuousClock.Instant
}
private struct TTSText: Encodable {
    enum CodingKeys: String, CodingKey { case text, contextID = "context_id", flush }
    let text: String
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
