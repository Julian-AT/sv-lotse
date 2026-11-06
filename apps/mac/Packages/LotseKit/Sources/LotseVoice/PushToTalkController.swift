import Foundation

@MainActor
public final class PushToTalkController {
    public var onError: ((Error) -> Void)?
    private let transcription: any TranscriptionProvider
    private var activeHoldID: UUID?
    private(set) var startTask: Task<Void, Never>?

    public init(transcription: any TranscriptionProvider) { self.transcription = transcription }

    public func handle(_ transition: ShortcutTransition) {
        switch transition {
        case .pressed:
            let holdID = UUID()
            activeHoldID = holdID
            startTask?.cancel()
            startTask = Task { @MainActor [weak self] in
                guard let self, activeHoldID == holdID else { return }
                defer { if activeHoldID == holdID { startTask = nil } }
                do {
                    try await transcription.start(whileHeld: { [weak self] in self?.activeHoldID == holdID })
                    guard activeHoldID == holdID else { return }
                } catch is CancellationError {
                    return
                } catch {
                    guard activeHoldID == holdID else { return }
                    onError?(error)
                }
            }
        case .released:
            activeHoldID = nil
            startTask?.cancel()
            startTask = nil
            transcription.finish()
        case .cancelled:
            cancel()
        case .none: break
        }
    }

    public func cancel() {
        activeHoldID = nil
        startTask?.cancel()
        startTask = nil
        transcription.cancel()
    }
}
