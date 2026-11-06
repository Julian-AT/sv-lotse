import Foundation

@MainActor
public protocol TranscriptionProvider: AnyObject {
    var onTranscript: ((String, Bool) -> Void)? { get set }
    var onError: ((Error) -> Void)? { get set }
    func start(whileHeld: @escaping @MainActor () -> Bool) async throws
    func finish()
    func cancel()
}

@MainActor
public final class FallbackTranscriptionProvider: TranscriptionProvider {
    public var onTranscript: ((String, Bool) -> Void)?
    public var onError: ((Error) -> Void)?
    private let primary: any TranscriptionProvider
    private let fallback: any TranscriptionProvider
    private var usingFallback = false
    private var isHeld: @MainActor () -> Bool = { false }
    private var recovery: Task<Void, Never>?
    private var generation = UUID()

    public init(primary: any TranscriptionProvider, fallback: any TranscriptionProvider = AppleSpeechTranscriptionProvider()) {
        self.primary = primary
        self.fallback = fallback
        primary.onTranscript = { [weak self] in self?.onTranscript?($0, $1) }
        fallback.onTranscript = { [weak self] in self?.onTranscript?($0, $1) }
        primary.onError = { [weak self] error in
            VoiceProviderStatus.shared.fellBack(error)
            self?.recover()
        }
        fallback.onError = { [weak self] in self?.onError?($0) }
    }

    public func start(whileHeld: @escaping @MainActor () -> Bool) async throws {
        generation = UUID()
        recovery?.cancel()
        isHeld = whileHeld
        usingFallback = false
        do {
            try await primary.start(whileHeld: whileHeld)
            VoiceProviderStatus.shared.usingElevenLabs()
        } catch {
            try Task.checkCancellation()
            guard whileHeld() else { throw CancellationError() }
            VoiceProviderStatus.shared.fellBack(error)
            usingFallback = true
            try await fallback.start(whileHeld: whileHeld)
        }
    }

    public func finish() {
        isHeld = { false }
        recovery?.cancel()
        if usingFallback { fallback.finish() } else { primary.finish() }
    }

    public func cancel() {
        generation = UUID()
        isHeld = { false }
        recovery?.cancel()
        primary.cancel()
        fallback.cancel()
    }

    private func recover() {
        guard isHeld(), usingFallback == false else { return }
        usingFallback = true
        let generation = generation
        recovery = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await fallback.start(whileHeld: { [weak self] in
                    self?.generation == generation && self?.isHeld() == true
                })
            } catch is CancellationError { return } catch { onError?(TranscriptionError.unavailable) }
        }
    }
}
