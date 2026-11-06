import Foundation
import LotseProtocol
import os

/// Speaks through one ElevenLabs socket kept for the whole conversation. Each sentence is sent the moment
/// it arrives (`prefetch`) and plays from its first audio chunk when its turn comes (`speak`).
@MainActor
final class ElevenLabsSpeechOutput {
    private let loadToken: VoiceTokenLoader
    private let connect: @MainActor (URL) -> any TTSTransport
    private let keepaliveInterval: Duration
    private let idleLimit: Duration
    private var connection: Task<TTSStream, Error>?
    private var connectionLanguage: String?
    private var live: TTSStream?
    private var lastReopen: ContinuousClock.Instant?
    private var prepared: [String: Task<TTSUtterance, Error>] = [:]
    private var playing: TTSUtterance?
    private var player: PCMStreamingPlayer?
    private(set) var voiceID: String?
    private(set) var didStart = false
    /// Stage timings of the last segment, for the log and live tests.
    private(set) var lastTimings = ""
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    init(
        loadToken: @escaping VoiceTokenLoader,
        connect: @escaping @MainActor (URL) -> any TTSTransport = { WebSocketTransport(url: $0) },
        keepaliveInterval: Duration = VoiceConfiguration.ttsKeepaliveInterval,
        idleLimit: Duration = VoiceConfiguration.ttsIdleLimit
    ) {
        self.loadToken = loadToken
        self.connect = connect
        self.keepaliveInterval = keepaliveInterval
        self.idleLimit = idleLimit
    }

    /// Opens the conversation socket in the background unless it is already open.
    func prewarm(language: String) { _ = stream(Self.ttsLanguage(language)) }

    /// Sends a queued sentence to ElevenLabs now, so its audio is ready when the sentences before it end.
    func prefetch(_ segment: SpeechSegment) {
        let key = Self.key(segment)
        guard prepared[key] == nil else { return }
        prepared[key] = request(segment)
    }

    func speak(_ segment: SpeechSegment, speed: Double, onStart: @escaping () -> Void) async throws {
        didStart = false
        let begin = ContinuousClock.now
        let utterance = try await (prepared.removeValue(forKey: Self.key(segment)) ?? request(segment)).value
        playing = utterance
        defer { utterance.cancel(); playing = nil }
        try Task.checkCancellation()
        let player = try PCMStreamingPlayer(speed: speed)
        self.player = player
        player.onStart = { [weak self] in self?.didStart = true; onStart() }
        defer { player.stop(); self.player = nil }
        var received = false
        for try await chunk in utterance.audio {
            try player.append(chunk)
            if received == false {
                received = true
                logTimings(segment, utterance, playback: ContinuousClock.now - begin)
            }
        }
        try Task.checkCancellation()
        guard received else { throw VoiceProviderError(message: "leeres Audio für Stimme \(voiceID ?? "?")") }
        await player.finish()
        try Task.checkCancellation()
    }

    /// Barge-in: drops every queued and playing sentence but keeps the socket for the next question.
    func stop() {
        for task in prepared.values {
            task.cancel()
            Task { @MainActor in (try? await task.value)?.cancel() }
        }
        prepared.removeAll()
        playing?.cancel()
        playing = nil
        player?.stop()
        player = nil
    }

    /// Renders short fixed lines on the conversation socket, for playback later without the network.
    func render(_ lines: [String], language: String) async throws -> (voice: String, clips: [Data]) {
        let stream = try await openStream(Self.ttsLanguage(language))
        var clips: [Data] = []
        for line in lines {
            var clip = Data()
            for try await chunk in stream.synthesize(line).audio { clip.append(chunk) }
            clips.append(clip)
        }
        return (stream.voice, clips)
    }

    private func request(_ segment: SpeechSegment) -> Task<TTSUtterance, Error> {
        let language = Self.ttsLanguage(segment.language)
        let requested = ContinuousClock.now
        return Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            let stream = try await openStream(language)
            try Task.checkCancellation()
            return stream.synthesize(segment.text, requested: requested)
        }
    }

    private func openStream(_ language: String) async throws -> TTSStream {
        let pending = stream(language)
        if let ready = try? await pending.value, ready.isOpen { return ready }
        if connection == pending { discard() }
        return try await stream(language).value
    }

    private func stream(_ language: String) -> Task<TTSStream, Error> {
        if let connection, connectionLanguage == language { return connection }
        discard()
        let task = Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            return try await open(language)
        }
        connection = task
        connectionLanguage = language
        return task
    }

    private func discard() {
        live?.close(nil)
        live = nil
        connection = nil
        connectionLanguage = nil
    }

    private func open(_ language: String) async throws -> TTSStream {
        let token = try await loadToken(.ttsWebsocket, language)
        guard let voice = token.voiceId, let model = token.modelId,
            var url = URLComponents(string: VoiceConfiguration.ttsURL)
        else { throw VoiceServiceError.unavailable }
        url.path += "/\(voice)/multi-stream-input"
        url.queryItems = [
            .init(name: "single_use_token", value: token.token), .init(name: "model_id", value: model),
            .init(name: "output_format", value: VoiceConfiguration.audioFormat),
            .init(name: "inactivity_timeout", value: String(VoiceConfiguration.ttsInactivityTimeoutSeconds)),
            .init(name: "auto_mode", value: "true")
        ]
        guard let address = url.url else { throw VoiceServiceError.unavailable }
        let stream = TTSStream(
            transport: connect(address), language: language, voice: voice,
            aliases: token.vocabulary?.pronunciationAliases ?? [],
            keepaliveInterval: keepaliveInterval, idleLimit: idleLimit
        )
        guard connectionLanguage == language else {
            stream.close(nil)
            throw CancellationError()
        }
        stream.onClose = { [weak self, weak stream] error in
            guard let self, let stream else { return }
            closed(stream, error: error)
        }
        live = stream
        voiceID = voice
        return stream
    }

    /// A socket that dropped mid-conversation is replaced in the background, at most once per interval,
    /// so the next sentence never waits for the token and handshake.
    private func closed(_ stream: TTSStream, error: Error?) {
        guard live === stream else { return }
        live = nil
        connection = nil
        connectionLanguage = nil
        guard let error else { return }
        log.error("TTS socket closed: \(error.localizedDescription, privacy: .public)")
        if let lastReopen, ContinuousClock.now - lastReopen < VoiceConfiguration.ttsReopenInterval { return }
        lastReopen = .now
        _ = self.stream(stream.language)
    }

    private func logTimings(_ segment: SpeechSegment, _ utterance: TTSUtterance, playback: Duration) {
        let firstAudio = (utterance.firstAudio ?? .now) - utterance.requested
        lastTimings = "text→first audio \(Self.milliseconds(firstAudio)) ms, playback start \(Self.milliseconds(playback)) ms"
        log.info("TTS segment \(segment.index, privacy: .public): \(self.lastTimings, privacy: .public)")
    }

    private static func key(_ segment: SpeechSegment) -> String { "\(segment.turnID)#\(segment.index)" }
    private static func milliseconds(_ duration: Duration) -> Int { ScribeRealtimeTranscriptionProvider.milliseconds(duration) }
    nonisolated static func ttsLanguage(_ language: String) -> String { language.hasPrefix("en") ? "en" : "de" }
}
