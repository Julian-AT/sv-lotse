import AVFoundation
import Foundation

@MainActor
public final class ScribeRealtimeTranscriptionProvider: TranscriptionProvider {
    public var onTranscript: ((String, Bool) -> Void)?
    public var onError: ((Error) -> Void)?
    private let loadToken: VoiceTokenLoader
    private let language: @MainActor () -> String
    private var sessions: [UUID: ScribeSession] = [:]
    private var active: UUID?
    private var pending: UUID?

    public init(loadToken: @escaping VoiceTokenLoader, language: @escaping @MainActor () -> String = { "de" }) {
        self.loadToken = loadToken
        self.language = language
    }

    public func start(whileHeld: @escaping @MainActor () -> Bool) async throws {
        if let active { remove(active) }
        let id = UUID()
        pending = id
        defer { if pending == id { pending = nil } }
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        try checkHold(id, whileHeld)
        guard granted else { throw TranscriptionError.permissionRequired }
        let language = language()
        let token = try await loadToken(.realtimeScribe, language)
        try checkHold(id, whileHeld)
        let socket = try makeSocket(token: token.token, language: language, keyterms: (token.vocabulary ?? .bundled).keyterms)
        let deadline = Task { @MainActor in
            do { try await Task.sleep(for: VoiceConfiguration.connectionTimeout) } catch { return }
            socket.cancel(with: .goingAway, reason: nil)
        }
        defer { deadline.cancel() }
        do {
            let hello = try await receiveVoiceMessage(ScribeEvent.self, from: socket)
            try checkHold(id, whileHeld)
            guard hello.messageType == "session_started" else { throw VoiceServiceError.unavailable }
            let input = try ScribeAudioInput()
            let session = ScribeSession(socket: socket, input: input)
            sessions[id] = session
            active = id
            startTransport(session, id: id)
        } catch {
            socket.cancel(with: .goingAway, reason: nil)
            throw error
        }
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
        pending = nil
        guard let id = active, let session = sessions[id] else { return }
        active = nil
        session.released = true
        session.input.stop()
        session.deadline = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: VoiceConfiguration.finalTimeout) } catch { return }
            self?.complete(id)
        }
    }

    public func cancel() {
        pending = nil
        for id in Array(sessions.keys) { remove(id) }
    }

    private func checkHold(_ id: UUID, _ held: @MainActor () -> Bool) throws {
        try Task.checkCancellation()
        guard pending == id, held() else { throw CancellationError() }
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
    let input: ScribeAudioInput
    var sender: Task<Void, Never>?
    var receiver: Task<Void, Never>?
    var deadline: Task<Void, Never>?
    var accumulator = TranscriptAccumulator()
    var released = false
    init(socket: URLSessionWebSocketTask, input: ScribeAudioInput) { self.socket = socket; self.input = input }
}
