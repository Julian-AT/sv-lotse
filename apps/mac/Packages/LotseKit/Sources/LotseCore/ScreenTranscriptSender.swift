import Foundation
import LotseCapture
import LotseProtocol

@MainActor
final class ScreenTranscriptSender {
    var focus: ScreenFocus?
    var captureFailed: (() -> Void)?
    var sendFailed: (() -> Void)?
    private let capture: @MainActor (ScreenFocus?, String) async throws -> ContextCapsule
    private let send: @MainActor (Transcript) async throws -> Void
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private var tail: Task<Void, Never>?

    init(
        capture: @escaping @MainActor (ScreenFocus?, String) async throws -> ContextCapsule = {
            try await ScreenContextCapture.capture(focus: $0, language: $1)
        },
        send: @escaping @MainActor (Transcript) async throws -> Void
    ) {
        self.capture = capture
        self.send = send
    }

    func submit(_ text: String, final: Bool, language: String) {
        let reservedFocus = final ? focus : nil
        if final { focus = nil }
        let identifier = UUID()
        let previous = tail
        let task = Task { @MainActor [weak self] in
            guard let self, Task.isCancelled == false else { return }
            defer { tasks.removeValue(forKey: identifier) }
            var capsule: ContextCapsule?
            if final {
                do { capsule = try await capture(reservedFocus, language) } catch {
                    guard Task.isCancelled == false else { return }
                    // Permission denial must not discard the user's spoken question.
                    captureFailed?()
                }
            }
            await previous?.value
            guard Task.isCancelled == false else { return }
            do {
                try await send(Transcript(capsule: capsule, language: language, text: text, transcriptFinal: final))
            } catch {
                guard Task.isCancelled == false else { return }
                sendFailed?()
            }
        }
        tasks[identifier] = task
        tail = task
    }

    func cancel() {
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
        tail = nil
        focus = nil
    }

    func waitForPendingTranscripts() async { await tail?.value }
}
