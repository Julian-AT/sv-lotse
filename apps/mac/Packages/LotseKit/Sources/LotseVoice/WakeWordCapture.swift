import Foundation

/// Hands-free question after „Meine SV“: records through the push-to-talk transcription provider and
/// ends on a short silence, or cancels when nothing is said.
@MainActor
public final class WakeWordCapture {
    public enum Outcome: Sendable { case sent, cancelled }
    public var onEnded: ((Outcome) -> Void)?
    public var onError: ((Error) -> Void)?
    public private(set) var isActive = false
    private let transcription: any TranscriptionProvider
    private let silence: Duration
    private let noSpeech: Duration
    private let finalGrace: Duration
    private var session = UUID()
    private var timer: Task<Void, Never>?
    private var finishing = false

    public init(
        transcription: any TranscriptionProvider, silence: Duration = .milliseconds(1200),
        noSpeech: Duration = .seconds(5), finalGrace: Duration = .seconds(3)
    ) {
        self.transcription = transcription
        self.silence = silence
        self.noSpeech = noSpeech
        self.finalGrace = finalGrace
    }

    public func begin() {
        abandon()
        let session = UUID()
        self.session = session
        isActive = true
        finishing = false
        arm(noSpeech, session: session) { $0.cancel() }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await transcription.start(whileHeld: { [weak self] in
                    self?.session == session && self?.isActive == true && self?.finishing == false
                })
            } catch is CancellationError {
                return
            } catch {
                guard self.session == session, isActive else { return }
                end(.cancelled)
                onError?(error)
            }
        }
    }

    /// Feed every transcript update while active. Returns the text to forward, without the wake phrase.
    public func received(_ text: String, final: Bool) -> String {
        let stripped = WakeWordMatcher.strip(text)
        guard isActive else { return stripped }
        if final {
            end(stripped.isEmpty ? .cancelled : .sent)
            return stripped
        }
        guard finishing == false, stripped.isEmpty == false else { return stripped }
        arm(silence, session: session) { $0.finish() }
        return stripped
    }

    /// Stops listening and drops the recording.
    public func cancel() {
        guard isActive else { return }
        transcription.cancel()
        end(.cancelled)
    }

    /// Forgets the session without touching the provider (push-to-talk takes it over).
    public func abandon() {
        guard isActive else { return }
        end(.cancelled)
    }

    private func finish() {
        guard isActive, finishing == false else { return }
        finishing = true
        transcription.finish()
        // The final transcript ends the session; this only guards a provider that never delivers one.
        arm(finalGrace, session: session) { $0.end(.sent) }
    }

    private func arm(_ delay: Duration, session: UUID, action: @escaping @MainActor (WakeWordCapture) -> Void) {
        timer?.cancel()
        timer = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: delay) } catch { return }
            guard let self, self.session == session, isActive else { return }
            action(self)
        }
    }

    private func end(_ outcome: Outcome) {
        timer?.cancel()
        timer = nil
        isActive = false
        finishing = false
        session = UUID()
        onEnded?(outcome)
    }
}
