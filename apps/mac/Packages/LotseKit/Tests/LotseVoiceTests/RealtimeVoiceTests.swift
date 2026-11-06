import Foundation
import LotseProtocol
import Testing

@testable import LotseVoice

@Test("FR-C1 Scribe and ElevenLabs audio events decode the documented wire names")
func realtimeEvents() throws {
    let event = try JSONDecoder().decode(ScribeEvent.self, from: Data(#"{"message_type":"partial_transcript","text":"Bitte öffnen"}"#.utf8))
    #expect(event.messageType == "partial_transcript")
    #expect(event.text == "Bitte öffnen")
    let audio = try JSONDecoder().decode(TTSAudio.self, from: Data(#"{"audio":"AAA=","contextId":"sentence","isFinal":true}"#.utf8))
    #expect(audio.contextId == "sentence")
    #expect(audio.isFinal == true)
}

@Test("FR-C1 failed Scribe startup uses Apple only while the key remains held")
@MainActor
func primaryFailureFallsBack() async throws {
    let primary = TranscriptionSpy()
    let apple = TranscriptionSpy()
    primary.startError = VoiceServiceError.unavailable
    let provider = FallbackTranscriptionProvider(primary: primary, fallback: apple)
    var updates: [TranscriptUpdate] = []
    provider.onTranscript = { updates.append(.init(text: $0, final: $1)) }
    try await provider.start(whileHeld: { true })
    apple.onTranscript?("Bitte öffnen", false)
    provider.finish()
    apple.onTranscript?("Bitte öffnen", true)
    #expect(primary.starts == 1)
    #expect(apple.starts == 1)
    #expect(apple.finishes == 1)
    #expect(updates.map(\.final) == [false, true])
    provider.cancel()
}

@Test("FR-C1 a release during failed provider startup cannot activate the fallback microphone")
@MainActor
func releasedProviderFailure() async {
    let primary = TranscriptionSpy()
    let apple = TranscriptionSpy()
    var held = true
    primary.onStart = { held = false }
    primary.startError = VoiceServiceError.unavailable
    let provider = FallbackTranscriptionProvider(primary: primary, fallback: apple)
    do {
        try await provider.start(whileHeld: { held })
        Issue.record("Released start must cancel")
    } catch is CancellationError {
        #expect(apple.starts == 0)
    } catch { Issue.record("Expected cancellation") }
    provider.cancel()
}

@Test("FR-C4 sentence actions wait for playback, accept late actions and never execute twice")
@MainActor
func sentenceActionsFollowPlayback() {
    let scheduler = SentenceActionScheduler()
    var actions: [Action] = []
    scheduler.onAction = { actions.append($0) }
    let first = caption(id: "first", sentence: 0)
    let late = caption(id: "late", sentence: 0)
    scheduler.enqueue(first)
    #expect(actions.isEmpty)
    scheduler.start(segment(index: 0, actions: ["first", "late"]))
    scheduler.enqueue(late)
    scheduler.enqueue(first)
    #expect(actions == [first, late])
    scheduler.reset()
    scheduler.start(segment(index: 1, actions: ["first"]))
    #expect(actions.count == 2)
}

@Test("FR-C4 barge-in cancels queued speech and discards later segments from the interrupted turn")
@MainActor
func bargeInDiscardsPendingSpeech() async {
    var requests = 0
    var controls: [SpeechControl] = []
    let playback = SpeechPlaybackController { _, _ in requests += 1; throw VoiceServiceError.unavailable }
    playback.onControl = { controls.append($0) }
    playback.enqueue(segment(index: 0))
    playback.stop()
    playback.enqueue(segment(index: 1))
    await Task.yield()
    #expect(requests == 0)
    #expect(controls.last?.stop == true)
    #expect(controls.last?.state == .idle)
    playback.speed = 3
    #expect(playback.speed == 1.5)
    playback.speed = 0.1
    #expect(playback.speed == 0.5)
}

@Test("FR-C4 workspace stop acknowledges idle without echoing another stop request")
@MainActor
func workspaceStopAcknowledgement() {
    let playback = SpeechPlaybackController { _, _ in throw VoiceServiceError.unavailable }
    var controls: [SpeechControl] = []
    playback.onControl = { controls.append($0) }
    playback.enqueue(segment(index: 0))
    playback.handle(.init(segmentIndex: 0, state: .speaking, stop: true))
    #expect(controls == [.init(segmentIndex: 0, state: .idle, stop: false)])
}

@MainActor
private final class TranscriptionSpy: TranscriptionProvider {
    var onTranscript: ((String, Bool) -> Void)?
    var onError: ((Error) -> Void)?
    var onStart: (() -> Void)?
    var startError: Error?
    var starts = 0
    var finishes = 0
    func start(whileHeld: @escaping @MainActor () -> Bool) async throws {
        starts += 1
        onStart?()
        if let startError { throw startError }
    }
    func finish() { finishes += 1 }
    func cancel() {}
}
private func caption(id: String, sentence: Int) -> Action {
    .caption(.init(id: id, kind: .caption, payload: .init(label: "Arbeitsbereich", style: nil), sentenceIndex: sentence,
                  target: .point(.init(confidence: 1, kind: .point, screenIndex: 0, x: 0.5, y: 0.5))))
}
private func segment(index: Int, actions: [String] = []) -> SpeechSegment {
    .init(actionIDS: actions, citations: [], index: index, language: "de-AT", text: "Bitte öffnen Sie den Arbeitsbereich.", turnID: "turn")
}
