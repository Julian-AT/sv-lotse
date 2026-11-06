import AVFoundation
import Foundation
import os

@MainActor
public final class ScribeRealtimeTranscriptionProvider: TranscriptionProvider {
    public var onTranscript: ((String, Bool) -> Void)?
    public var onError: ((Error) -> Void)?
    private let loadToken: VoiceTokenLoader
    private let language: @MainActor () -> String
    private var sessions: [UUID: ScribeSession] = [:]
    private var active: UUID?
    private var pending: UUID?
    /// `finish()` arrived while the pending capture was still connecting.
    private var pendingReleased = false
    private let makeInput: @MainActor () throws -> any ScribeAudioSource
    private let requestAccess: @MainActor () async -> Bool
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")
    /// Release → clean final transcript of the last capture, for the status log and tests.
    private(set) var lastFinalLatency: Duration?
    private var releasedAt: ContinuousClock.Instant?
    private var pendingInput: (any ScribeAudioSource)?

    public convenience init(loadToken: @escaping VoiceTokenLoader, language: @escaping @MainActor () -> String = { "de" }) {
        self.init(loadToken: loadToken, language: language, makeInput: { try ScribeAudioInput() },
                  requestAccess: { await AVCaptureDevice.requestAccess(for: .audio) })
    }

    init(
        loadToken: @escaping VoiceTokenLoader, language: @escaping @MainActor () -> String,
        makeInput: @escaping @MainActor () throws -> any ScribeAudioSource,
        requestAccess: @escaping @MainActor () async -> Bool
    ) {
        self.loadToken = loadToken
        self.language = language
        self.makeInput = makeInput
        self.requestAccess = requestAccess
    }

    /// The microphone starts before the token and socket: the first words spoken right after the
    /// key press are buffered in the stream instead of being lost during the ~1 s handshake.
    public func start(whileHeld: @escaping @MainActor () -> Bool) async throws {
        if let active { remove(active) }
        let id = UUID()
        pending = id
        pendingReleased = false
        defer { if pending == id { pending = nil } }
        let started = ContinuousClock.now
        let granted = await requestAccess()
        try checkHold(id, whileHeld)
        guard granted else { throw TranscriptionError.permissionRequired }
        let input = try makeInput()
        pendingInput = input
        defer { if pendingInput === input { pendingInput = nil } }
        var socket: URLSessionWebSocketTask?
        do {
            let language = language()
            let token = try await loadToken(.realtimeScribe, language)
            try checkHold(id, whileHeld)
            let opened = try makeSocket(token: token.token, language: language, keyterms: (token.vocabulary ?? .bundled).keyterms)
            socket = opened
            let deadline = Task { @MainActor in
                do { try await Task.sleep(for: VoiceConfiguration.connectionTimeout) } catch { return }
                opened.cancel(with: .goingAway, reason: nil)
            }
            defer { deadline.cancel() }
            let hello = try await receiveVoiceMessage(ScribeEvent.self, from: opened)
            guard hello.messageType == "session_started" else { throw VoiceServiceError.unavailable }
            try checkHold(id, whileHeld)
            log.info("Scribe ready after \(Self.milliseconds(ContinuousClock.now - started), privacy: .public) ms")
            let session = ScribeSession(socket: opened, input: input)
            sessions[id] = session
            // A release during the handshake still sends what was said; only a cancel discards it.
            if pendingReleased { session.released = true; session.releasedAt = releasedAt }
            active = session.released ? nil : id
            startTransport(session, id: id)
            if session.released { finishSession(id, session) }
        } catch {
            input.stop()
            socket?.cancel(with: .goingAway, reason: nil)
            throw error
        }
    }

    nonisolated static func milliseconds(_ duration: Duration) -> Int {
        Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
    }

    private func startTransport(_ session: ScribeSession, id: UUID) {
        let input = session.input
        let socket = session.socket
        session.sender = Task { @MainActor [weak self] in
            do {
                for await chunk in input.chunks {
                    try Task.checkCancellation()
                    try await sendVoiceMessage(ScribeChunk(audioBase64: chunk.base64EncodedString(), commit: false), to: socket)
                }
                try Task.checkCancellation()
                try await sendVoiceMessage(ScribeChunk(audioBase64: "", commit: true), to: socket)
            } catch { self?.failed(id) }
        }
        session.receiver = Task { @MainActor [weak self] in
            do {
                while Task.isCancelled == false {
                    let event = try await receiveVoiceMessage(ScribeEvent.self, from: socket)
                    guard let self, sessions[id] != nil else { return }
                    try handle(event, id: id)
                }
            } catch { self?.failed(id) }
        }
    }

    public func finish() {
        if pending != nil, active == nil {
            pendingReleased = true
            releasedAt = .now
            pendingInput?.stop()
            return
        }
        pending = nil
        guard let id = active, let session = sessions[id] else { return }
        active = nil
        session.released = true
        session.releasedAt = .now
        finishSession(id, session)
    }

    private func finishSession(_ id: UUID, _ session: ScribeSession) {
        session.input.stop()
        session.deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: VoiceConfiguration.finalTimeout) } catch { return }
            self?.complete(id)
        }
    }

    public func cancel() {
        pending = nil
        pendingInput?.stop()
        pendingInput = nil
        for id in Array(sessions.keys) { remove(id) }
    }

    /// Only `cancel()` (or a newer capture) aborts a connecting capture. A release during the handshake
    /// arrives as `finish()` and still sends what was said into the buffered microphone stream.
    private func checkHold(_ id: UUID, _ held: @MainActor () -> Bool) throws {
        try Task.checkCancellation()
        guard pending == id, held() || pendingReleased else { throw CancellationError() }
    }

    private func makeSocket(token: String, language: String, keyterms: [String]) throws -> URLSessionWebSocketTask {
        guard var url = URLComponents(string: VoiceConfiguration.scribeURL) else { throw VoiceServiceError.unavailable }
        url.queryItems = [
            .init(name: "token", value: token), .init(name: "model_id", value: VoiceConfiguration.scribeModel),
            .init(name: "audio_format", value: VoiceConfiguration.audioFormat), .init(name: "language_code", value: language),
            .init(name: "commit_strategy", value: "manual")
        ]
        url.queryItems?.append(contentsOf: keyterms.filter {
            $0.count <= VoiceConfiguration.maximumKeytermCharacters
        }.prefix(VoiceConfiguration.maximumKeyterms).map { URLQueryItem(name: "keyterms", value: $0) })
        guard let address = url.url else { throw VoiceServiceError.unavailable }
        let socket = URLSession.shared.webSocketTask(with: address)
        socket.resume()
        return socket
    }

    private func handle(_ event: ScribeEvent, id: UUID) throws {
        guard let session = sessions[id] else { return }
        switch event.messageType {
        case "partial_transcript", "committed_transcript", "committed_transcript_with_timestamps":
            if let update = session.accumulator.receive(event.text ?? "", final: false) { onTranscript?(update.text, false) }
            if event.messageType != "partial_transcript", session.released { complete(id) }
        case "session_started": break
        default: throw VoiceServiceError.unavailable
        }
    }

    private func failed(_ id: UUID) {
        guard let session = sessions[id] else { return }
        if session.released { complete(id) } else { remove(id); onError?(TranscriptionError.unavailable) }
    }

    private func complete(_ id: UUID) {
        guard let session = sessions[id] else { return }
        let update = session.accumulator.finish()
        if let releasedAt = session.releasedAt {
            lastFinalLatency = ContinuousClock.now - releasedAt
            log.info("Scribe final \(Self.milliseconds(ContinuousClock.now - releasedAt), privacy: .public) ms after release")
        }
        remove(id)
        if let update { onTranscript?(VoiceVocabulary.replacing(update.text, aliases: VoiceVocabulary.bundled.spellingAliases), true) }
    }

    private func remove(_ id: UUID) {
        guard let session = sessions.removeValue(forKey: id) else { return }
        if active == id { active = nil }
        session.input.stop()
        session.sender?.cancel()
        session.receiver?.cancel()
        session.deadline?.cancel()
        session.socket.cancel(with: .goingAway, reason: nil)
    }
}

private struct ScribeChunk: Encodable {
    enum CodingKeys: String, CodingKey {
        case messageType = "message_type", audioBase64 = "audio_base_64", commit, sampleRate = "sample_rate"
    }
    let messageType = "input_audio_chunk"
    let audioBase64: String
    let commit: Bool
    let sampleRate = Int(VoiceConfiguration.sampleRate)
}
struct ScribeEvent: Decodable {
    enum CodingKeys: String, CodingKey { case messageType = "message_type", text }
    let messageType: String
    let text: String?
}
@MainActor
private final class ScribeSession {
    let socket: URLSessionWebSocketTask
    let input: any ScribeAudioSource
    var releasedAt: ContinuousClock.Instant?
    var sender: Task<Void, Never>?
    var receiver: Task<Void, Never>?
    var deadline: Task<Void, Never>?
    var accumulator = TranscriptAccumulator()
    var released = false
    init(socket: URLSessionWebSocketTask, input: any ScribeAudioSource) { self.socket = socket; self.input = input }
}
