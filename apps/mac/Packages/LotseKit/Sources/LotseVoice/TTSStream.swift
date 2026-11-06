import Foundation
import os

@MainActor
protocol TTSTransport: AnyObject {
    func send(_ text: String) async throws
    func receive() async throws -> Data
    func close()
}

@MainActor
final class WebSocketTransport: TTSTransport {
    private let task: URLSessionWebSocketTask

    init(url: URL) {
        task = URLSession.shared.webSocketTask(with: url)
        task.resume()
    }

    func send(_ text: String) async throws { try await task.send(.string(text)) }

    func receive() async throws -> Data {
        switch try await task.receive() {
        case .data(let bytes): return bytes
        case .string(let text): return Data(text.utf8)
        @unknown default: throw VoiceServiceError.invalidResponse
        }
    }

    func close() { task.cancel(with: .normalClosure, reason: nil) }
}

/// One sentence on the shared socket. Audio arrives as it is generated and is buffered until played.
@MainActor
final class TTSUtterance {
    let context = UUID().uuidString
    let audio: AsyncThrowingStream<Data, Error>
    let requested: ContinuousClock.Instant
    fileprivate(set) var firstAudio: ContinuousClock.Instant?
    fileprivate weak var stream: TTSStream?

    fileprivate init(audio: AsyncThrowingStream<Data, Error>, requested: ContinuousClock.Instant) {
        self.audio = audio
        self.requested = requested
    }

    func cancel() { stream?.finish(context, throwing: CancellationError()) }
}

/// One ElevenLabs multi-context socket per conversation: every sentence gets its own context on it, a
/// keepalive context holds it open between turns, and it closes after `idleLimit` without speech.
@MainActor
final class TTSStream {
    static let keepaliveContext = "keepalive"
    let language: String
    let voice: String
    private(set) var isOpen = true
    /// Called once when the socket ends; the error is nil when it closed for idleness.
    var onClose: ((Error?) -> Void)?
    private let transport: any TTSTransport
    private let aliases: [VoiceAlias]
    private var contexts: [String: (utterance: TTSUtterance, continuation: AsyncThrowingStream<Data, Error>.Continuation, timeout: Task<Void, Never>)] = [:]
    private var lastUsed = ContinuousClock.now
    private var reader: Task<Void, Never>?
    private var keepalive: Task<Void, Never>?
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    init(transport: any TTSTransport, language: String, voice: String, aliases: [VoiceAlias],
         keepaliveInterval: Duration, idleLimit: Duration) {
        self.transport = transport
        self.language = language
        self.voice = voice
        self.aliases = aliases
        reader = Task { [weak self] in await self?.read() }
        keepalive = Task { [weak self] in
            await self?.send(TTSText(text: " ", contextID: Self.keepaliveContext, flush: false))
            while true {
                do { try await Task.sleep(for: keepaliveInterval) } catch { return }
                guard let self, isOpen else { return }
                if ContinuousClock.now - lastUsed > idleLimit, contexts.isEmpty { return close(nil) }
                await send(TTSText(text: "", contextID: Self.keepaliveContext, flush: false))
            }
        }
    }

    /// Sends the sentence right away with a flush; its audio is buffered in the returned utterance.
    func synthesize(_ text: String, requested: ContinuousClock.Instant = .now) -> TTSUtterance {
        let (audio, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        let utterance = TTSUtterance(audio: audio, requested: requested)
        guard isOpen else {
            continuation.finish(throwing: VoiceServiceError.unavailable)
            return utterance
        }
        utterance.stream = self
        lastUsed = .now
        let context = utterance.context
        let timeout = Task { [weak self] in
            do { try await Task.sleep(for: VoiceConfiguration.segmentTimeout) } catch { return }
            self?.finish(context, throwing: VoiceServiceError.unavailable)
        }
        contexts[context] = (utterance, continuation, timeout)
        let message = TTSText(text: VoiceVocabulary.replacing(text, aliases: aliases) + " ", contextID: context, flush: true)
        // Without the close, ElevenLabs sends isFinal only when the context times out (inactivity_timeout).
        Task { [weak self] in
            await self?.send(message)
            await self?.send(TTSCloseContext(contextID: context))
        }
        return utterance
    }

    func close(_ error: Error?) {
        guard isOpen else { return }
        isOpen = false
        for context in Array(contexts.keys) { finish(context, throwing: error ?? CancellationError()) }
        reader?.cancel()
        keepalive?.cancel()
        transport.close()
        onClose?(error)
        onClose = nil
    }

    fileprivate func finish(_ context: String, throwing error: Error?) {
        guard let entry = contexts.removeValue(forKey: context) else { return }
        entry.timeout.cancel()
        entry.continuation.finish(throwing: error)
    }

    private func send(_ message: some Encodable) async {
        guard isOpen else { return }
        do {
            let data = try JSONEncoder().encode(message)
            try await transport.send(String(decoding: data, as: UTF8.self))
        } catch {
            close(error)
        }
    }

    private func read() async {
        while isOpen {
            let data: Data
            do { data = try await transport.receive() } catch { return close(error) }
            guard let event = try? JSONDecoder().decode(TTSAudio.self, from: data) else { continue }
            route(event)
        }
    }

    private func route(_ event: TTSAudio) {
        let sole = contexts.count == 1 ? contexts.keys.first : nil
        guard let context = event.contextId ?? sole, let entry = contexts[context] else {
            if let message = event.error { log.error("TTS socket: \(message, privacy: .public)") }
            return
        }
        if let message = event.error {
            return finish(context, throwing: VoiceProviderError(message: String(message.prefix(200))))
        }
        if let audio = event.audio, audio.isEmpty == false {
            guard let data = Data(base64Encoded: audio) else { return finish(context, throwing: VoiceServiceError.invalidAudio) }
            if entry.utterance.firstAudio == nil { entry.utterance.firstAudio = .now }
            entry.continuation.yield(data)
        }
        guard event.isFinal == true else { return }
        // An empty final frame is how the multi-context socket refuses a voice (e.g. a library voice on the free tier).
        let refused = entry.utterance.firstAudio == nil ? VoiceProviderError(message: "leeres Audio für Stimme \(voice)") : nil
        finish(context, throwing: refused)
    }
}

struct TTSText: Encodable {
    enum CodingKeys: String, CodingKey { case text, contextID = "context_id", flush }
    let text: String
    let contextID: String
    let flush: Bool
}
struct TTSCloseContext: Encodable {
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
