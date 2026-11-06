import Foundation

@MainActor
protocol DictationTextTarget {
    func insert(_ text: String) async throws
}

@MainActor
public final class DictationController {
    public var onError: ((Error) -> Void)?
    public var onRecordingChanged: ((Bool) -> Void)?
    private let makeTranscription: @MainActor () -> AppleSpeechTranscriptionProvider
    private let captureTarget: @MainActor () throws -> DictationTextTarget
    private var transcription: AppleSpeechTranscriptionProvider?
    private var pushToTalk: PushToTalkController?
    private var target: DictationTextTarget?
    private var operationID: UUID?
    private var held = false
    private var insertionTask: Task<Void, Never>?

    public convenience init(localeIdentifier: @escaping @MainActor () -> String = { "de-AT" }) {
        self.init(
            makeTranscription: { AppleSpeechTranscriptionProvider(localeIdentifier: localeIdentifier) },
            captureTarget: { try AccessibilityDictationTarget.capture() }
        )
    }

    init(
        makeTranscription: @escaping @MainActor () -> AppleSpeechTranscriptionProvider,
        captureTarget: @escaping @MainActor () throws -> DictationTextTarget
    ) {
        self.makeTranscription = makeTranscription
        self.captureTarget = captureTarget
    }

    public func handle(_ transition: ShortcutTransition) {
        switch transition {
        case .pressed: begin()
        case .released:
            guard held else { return }
            held = false
            onRecordingChanged?(false)
            pushToTalk?.handle(.released)
        case .cancelled: cancel()
        case .none: break
        }
    }

    public func cancel() {
        operationID = nil
        held = false
        pushToTalk?.cancel()
        transcription = nil
        pushToTalk = nil
        target = nil
        insertionTask?.cancel()
        // Keep the task until it exits: its defer restores the clipboard before another paste.
        onRecordingChanged?(false)
    }

    private func begin() {
        guard operationID == nil, insertionTask == nil else { return }
        do { target = try captureTarget() } catch { onError?(error); return }
        let identifier = UUID()
        operationID = identifier
        held = true
        let provider = makeTranscription()
        transcription = provider
        let controller = PushToTalkController(transcription: provider)
        pushToTalk = controller
        provider.onTranscript = { [weak self] text, final in
            guard final else { return }
            self?.insert(text, operation: identifier)
        }
        provider.onFinalization = { [weak self] in
            guard let self, operationID == identifier, insertionTask == nil else { return }
            cancel()
        }
        let reportError: (Error) -> Void = { [weak self] error in
            guard let self, operationID == identifier else { return }
            cancel()
            onError?(error)
        }
        provider.onError = reportError
        controller.onError = reportError
        onRecordingChanged?(true)
        controller.handle(.pressed)
    }

    private func insert(_ text: String, operation identifier: UUID) {
        guard operationID == identifier, held == false, insertionTask == nil, let target else { return }
        let cleaned = VoiceVocabulary.replacing(text, aliases: VoiceVocabulary.bundled.spellingAliases)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleaned.isEmpty == false else { cancel(); return }
        insertionTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                insertionTask = nil
                if operationID == identifier { cancel() }
            }
            do {
                try Task.checkCancellation()
                try await target.insert(cleaned)
            } catch is CancellationError {
                return
            } catch {
                if operationID == identifier { onError?(error) }
            }
        }
    }
}
