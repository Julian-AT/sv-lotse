import CoreGraphics
@testable import LotseCore
import LotseOverlay
import LotseProtocol
import Testing

@Test("PRD 9 native captions and clear actions wait for their sentence and retain highlights on stop") @MainActor
func sourceActionsWaitForPlayback() throws {
    let overlay = OverlayWindowManager()
    let coordinator = SourceHighlightCoordinator(overlay: overlay)
    let rect = CGRect(x: -100, y: 20, width: 70, height: 14)
    overlay.state.highlights = [rect]
    let target = Target.ui(.init(elementID: "source", kind: .ui))
    let caption = Action.caption(.init(
        id: "caption", kind: .caption, payload: .init(label: "Original sentence.", style: nil),
        sentenceIndex: 1, target: target
    ))
    let clear = Action.clear(.init(
        id: "clear", kind: .clear, payload: .init(label: nil, style: nil), sentenceIndex: 2, target: target
    ))
    try coordinator.receive(.action(.init(id: "caption-envelope", payload: caption, type: .action, v: .the100)))
    try coordinator.receive(.action(.init(id: "clear-envelope", payload: clear, type: .action, v: .the100)))
    #expect(overlay.state.caption.isEmpty)
    #expect(overlay.state.highlights == [rect])
    coordinator.sentenceStarted(.init(
        actionIDS: ["caption"], citations: [], index: 1, language: "en", text: "Original sentence.", turnID: "turn"
    ))
    #expect(overlay.state.caption == "Original sentence.")
    #expect(overlay.state.highlights == [rect])
    coordinator.stop()
    #expect(overlay.state.highlights == [rect])
    try coordinator.receive(.action(.init(id: "clear-again", payload: clear, type: .action, v: .the100)))
    coordinator.sentenceStarted(.init(
        actionIDS: ["clear"], citations: [], index: 2, language: "en", text: "Next step.", turnID: "turn"
    ))
    #expect(overlay.state.highlights.isEmpty)
}

@Test("Source preparation uses shared playback and waits for its start callback") @MainActor
func sourceActionsUseSharedPlayback() async throws {
    let overlay = OverlayWindowManager()
    let segment = SpeechSegment(
        actionIDS: ["caption"], citations: [], index: 1, language: "en", text: "Spoken sentence.", turnID: "turn"
    )
    let caption = Action.caption(.init(
        id: "caption", kind: .caption, payload: .init(label: "Source caption.", style: nil),
        sentenceIndex: 1, target: .ui(.init(elementID: "source", kind: .ui))
    ))
    var didEnqueue: ((SpeechSegment) -> Void)?
    let coordinator = SourceHighlightCoordinator(overlay: overlay, enqueueSpeech: { didEnqueue?($0) })
    let queued = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<SpeechSegment, Error>) in
        didEnqueue = { continuation.resume(returning: $0) }
        do {
            try coordinator.receive(.action(.init(id: "action", payload: caption, type: .action, v: .the100)))
            try coordinator.receive(.speechSegment(.init(id: "segment", payload: segment, type: .speechSegment, v: .the100)))
        } catch { continuation.resume(throwing: error) }
    }
    #expect(queued == segment)
    #expect(overlay.state.caption.isEmpty)
    coordinator.sentenceStarted(segment)
    #expect(overlay.state.caption == "Source caption.")
}
