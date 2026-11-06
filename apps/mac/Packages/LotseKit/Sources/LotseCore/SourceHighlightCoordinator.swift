import AppKit
import CoreGraphics
import LotseBridge
import LotseCapture
import LotseOverlay
import LotseProtocol
import LotseResolver
import LotseVoice

private struct CaptureExclusions: Decodable {
    let bundleIdentifiers: [String]
}

@MainActor
final class SourceHighlightCoordinator {
    private let overlay: OverlayWindowManager
    private let speech = SegmentSpeechPlayer()
    private let enqueueSpeech: ((SpeechSegment) -> Void)?
    private let resolver = TextQuoteResolver()
    private var actions: [String: Action] = [:]
    private var prepared: [String: [CGRect]] = [:]
    private var actionOrder: [String] = []
    private var fired: Set<String> = []
    private var currentIndex: Int?
    private var generation = UUID()
    private var pending: Task<Void, Never>?
    var onControl: ((SpeechControl) -> Void)?
    var onResult: ((ActionResult) -> Void)?

    init(overlay: OverlayWindowManager, enqueueSpeech: ((SpeechSegment) -> Void)? = nil) {
        self.overlay = overlay
        self.enqueueSpeech = enqueueSpeech
        speech.onStart = { [weak self] segment in self?.sentenceStarted(segment) }
        speech.onIdle = { [weak self] segment in
            self?.onControl?(.init(segmentIndex: segment.index, state: .idle, stop: false))
        }
    }

    func connect(
        speech: SpeechPlaybackController, workspace: WorkspaceWindowController,
        overlayBridge: OverlayBridgeController, sentenceActions: SentenceActionScheduler
    ) {
        speech.onControl = { [weak self, weak workspace, weak overlayBridge] control in
            guard let self, let workspace, let overlayBridge else { return }
            forwardControl(control, workspace: workspace, overlayBridge: overlayBridge)
        }
        speech.onSentenceStart = { [weak self, weak overlayBridge, weak sentenceActions] segment in
            try? overlayBridge?.receive(.speechSegment(.init(
                id: UUID().uuidString, payload: segment, type: .speechSegment, v: .the100
            )))
            self?.sentenceStarted(segment)
            sentenceActions?.start(segment)
        }
        onResult = { [weak workspace] result in
            Task { @MainActor [weak workspace] in
                try? await workspace?.send(.actionResult(.init(
                    id: UUID().uuidString, payload: result, type: .actionResult, v: .the100
                )))
            }
        }
    }

    private func forwardControl(
        _ control: SpeechControl, workspace: WorkspaceWindowController, overlayBridge: OverlayBridgeController
    ) {
        try? overlayBridge.receive(.speechControl(.init(
            id: UUID().uuidString, payload: control, type: .speechControl, v: .the100
        )))
        Task { @MainActor [weak workspace] in
            try? await workspace?.send(.speechControl(.init(
                id: UUID().uuidString, payload: control, type: .speechControl, v: .the100
            )))
        }
    }

    func receive(_ message: BridgeToNative) throws {
        switch message {
        case .speechSegment(let envelope): enqueue(envelope.payload)
        case .speechControl(let envelope): if envelope.payload.stop { stop(notify: false) }
        case .action(let envelope): try receiveAction(envelope.payload)
        default: throw WorkspaceHighlightError.unsupported
        }
    }

    func clear() {
        stop(notify: false)
        overlay.state.clear()
        overlay.state.highlights = []
    }

    func beginTurn() {
        generation = UUID()
        pending?.cancel()
        pending = nil
        actionOrder.removeAll { fired.contains($0) }
        actions = actions.filter { fired.contains($0.key) == false }
        prepared.removeAll()
        fired.removeAll()
        currentIndex = nil
    }

    func stop(notify: Bool = true) {
        if notify { onControl?(.init(segmentIndex: currentIndex ?? 0, state: .idle, stop: true)) }
        generation = UUID()
        pending?.cancel()
        pending = nil
        speech.stop()
        actions.removeAll()
        actionOrder.removeAll()
        prepared.removeAll()
        fired.removeAll()
        currentIndex = nil
        // Stopping speech is not a new step: retain the visible source highlight.
    }

    private func receiveAction(_ action: Action) throws {
        switch action {
        case .type, .openResource: throw WorkspaceHighlightError.unsupported
        default: break
        }
        let id = action.sourceActionID
        if actions[id] == nil { actionOrder.append(id) }
        actions[id] = action
        if currentIndex == action.sourceSentenceIndex {
            let previous = pending
            let token = generation
            pending = Task { [weak self] in
                await previous?.value
                guard let self, token == generation else { return }
                await prepare([action])
                guard token == generation else { return }
                fire(action)
            }
        }
    }

    private func enqueue(_ segment: SpeechSegment) {
        let previous = pending
        let token = generation
        pending = Task { [weak self] in
            await previous?.value
            guard let self, token == generation else { return }
            let matching = actionOrder.compactMap { actions[$0] }.filter {
                $0.sourceSentenceIndex == segment.index || segment.actionIDS.contains($0.sourceActionID)
            }
            await prepare(matching)
            guard token == generation, Task.isCancelled == false else { return }
            if let enqueueSpeech { enqueueSpeech(segment) } else { speech.enqueue(segment) }
        }
    }

    private func prepare(_ matching: [Action]) async {
        let unresolved = matching.filter { prepared[$0.sourceActionID] == nil && $0.sourceText != nil }
        guard unresolved.isEmpty == false else { return }
        guard CGPreflightScreenCaptureAccess(), let excluded = captureExclusions() else { return }
        do {
            let screens = try await CompanionScreenCaptureUtility.captureAllScreensAsJPEG(excludingBundleIdentifiers: excluded)
            for action in unresolved {
                guard let target = action.sourceText else { continue }
                var matches: [[CGRect]] = []
                for screen in screens {
                    let boxes = try await resolver.resolve(
                        quote: target.quote, imageData: screen.imageData, displayFrame: screen.displayFrame
                    )
                    if boxes.isEmpty == false { matches.append(boxes) }
                }
                // The same sentence on two displays is ambiguous, never choose one arbitrarily.
                prepared[action.sourceActionID] = matches.count == 1 ? matches[0] : []
            }
        } catch {
            for action in unresolved { prepared[action.sourceActionID] = [] }
        }
    }

    func sentenceStarted(_ segment: SpeechSegment) {
        currentIndex = segment.index
        overlay.state.caption = segment.text
        for id in actionOrder {
            guard let action = actions[id],
                  action.sourceSentenceIndex == segment.index || segment.actionIDS.contains(id) else { continue }
            fire(action)
        }
        onControl?(.init(segmentIndex: segment.index, state: .speaking, stop: false))
    }

    private func fire(_ action: Action) {
        let id = action.sourceActionID
        guard fired.insert(id).inserted else { return }
        switch action {
        case .clear:
            overlay.state.clear()
            overlay.state.highlights = []
        case .caption(let caption): overlay.state.caption = caption.payload.label ?? ""
        case .highlight, .annotate, .point:
            let boxes = prepared[id] ?? []
            overlay.state.annotation = nil
            overlay.state.target = nil
            overlay.state.highlights = boxes
            if case .point = action, let box = boxes.first { overlay.state.target = CGPoint(x: box.midX, y: box.midY) }
            onResult?(.init(actionID: id, confidence: boxes.isEmpty ? 0 : 1,
                            failureReason: boxes.isEmpty ? "TEXT_NOT_FOUND" : nil,
                            resolvedBy: .ocr, success: boxes.isEmpty == false))
        default: break
        }
    }

    private func captureExclusions() -> Set<String>? {
        guard let url = Bundle.module.url(forResource: "capture-exclusions", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let policy = try? JSONDecoder().decode(CaptureExclusions.self, from: data),
              policy.bundleIdentifiers.isEmpty == false else { return nil }
        let additions = UserDefaults.standard.stringArray(forKey: CompanionConfiguration.captureExclusionsKey) ?? []
        return Set(policy.bundleIdentifiers + additions)
    }
}

enum WorkspaceHighlightError: Error { case unsupported }
