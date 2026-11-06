import Foundation
import LotseProtocol
import Testing

@testable import LotseVoice

private let clips = [Data([1, 0]), Data([2, 0]), Data([3, 0])]

@Test("A voice question plays a cached acknowledgement and the answer waits until it ends")
@MainActor
func acknowledgementPlaysBeforeAnswer() async {
    let spy = ClipSpy()
    let playback = makePlayback(spy, grace: .zero)
    playback.allowSpeechForVoiceTurn(language: "de")
    await settle { spy.played.count == 1 }
    #expect(spy.played == [clips[0]])
    #expect(playback.acknowledging)
    #expect(playback.isActive)
    let answer = segment(index: 0, text: "Das Pflegegeld beantragen Sie bei der PVA.")
    playback.enqueue(answer)
    await settle { playback.current != nil }
    #expect(playback.current == nil)
    spy.end()
    await settle { playback.current == answer }
    #expect(playback.current == answer)
    #expect(playback.acknowledging == false)
    playback.stop()
}

@Test("An answer that starts within the grace period skips the acknowledgement")
@MainActor
func fastAnswerSkipsAcknowledgement() async {
    let spy = ClipSpy()
    let playback = makePlayback(spy, grace: .seconds(60))
    playback.allowSpeechForVoiceTurn(language: "de")
    let answer = segment(index: 0, text: "Antwort.")
    playback.enqueue(answer)
    await settle { playback.current == answer }
    #expect(playback.current == answer)
    #expect(spy.played.isEmpty)
    playback.stop()
}

@Test("Typed turns never acknowledge; a typed message cancels a pending acknowledgement")
@MainActor
func typedTurnsStaySilent() async {
    let spy = ClipSpy()
    let playback = makePlayback(spy, grace: .milliseconds(50))
    playback.allowSpeechForVoiceTurn()
    playback.enqueue(segment(index: 0, text: "Antwort."))
    playback.handle(SpeechControl(segmentIndex: 0, state: .idle, stop: true))
    playback.allowSpeechForVoiceTurn(language: "de")
    playback.handle(SpeechControl(segmentIndex: 0, state: .idle, stop: true))
    try? await Task.sleep(for: .milliseconds(150))
    #expect(spy.played.isEmpty)
    #expect(playback.isActive == false)
}

@Test("Barge-in stops the acknowledgement and the answer queued behind it")
@MainActor
func bargeInStopsAcknowledgement() async {
    let spy = ClipSpy()
    let playback = makePlayback(spy, grace: .zero)
    playback.allowSpeechForVoiceTurn(language: "de")
    await settle { spy.played.count == 1 }
    playback.enqueue(segment(index: 0, text: "Antwort."))
    playback.stop(notify: false)
    #expect(playback.acknowledging == false)
    #expect(playback.isActive == false)
    #expect(playback.current == nil)
    await settle { spy.finished == 1 }
    #expect(spy.finished == 1)
    playback.allowSpeechForVoiceTurn(language: "de")
    await settle { spy.played.count == 2 }
    #expect(spy.played == [clips[0], clips[1]])
    playback.stop()
}

@Test("After an acknowledgement the brain's status line for the same turn is dropped")
@MainActor
func acknowledgementReplacesStatusLine() async {
    let spy = ClipSpy()
    let playback = makePlayback(spy, grace: .zero)
    playback.allowSpeechForVoiceTurn(language: "de")
    await settle { spy.played.count == 1 }
    playback.enqueue(segment(index: 0, text: "Einen Moment, ich schaue das kurz nach …"))
    let answer = segment(index: 1, text: "Hier ist die Antwort.")
    playback.enqueue(answer)
    spy.end()
    await settle { playback.current == answer }
    #expect(playback.current == answer)
    playback.stop()
}

@Test("Without a cached clip the question stays silent and the status line still speaks")
@MainActor
func missingClipSkipsSilently() async {
    let spy = ClipSpy()
    let playback = SpeechPlaybackController(loadToken: hangingToken, playClip: spy.play, acknowledgementGrace: .zero)
    playback.allowSpeechForVoiceTurn(language: "en")
    try? await Task.sleep(for: .milliseconds(50))
    #expect(spy.played.isEmpty)
    #expect(playback.isActive == false)
    let status = segment(index: 0, text: "One moment, I'm looking that up …", language: "en")
    playback.enqueue(status)
    await settle { playback.current == status }
    #expect(playback.current == status)
    playback.stop()
}

@Test("Status lines from the brain are recognised with or without the ellipsis")
func statusLineMatching() {
    #expect(AcknowledgementCopy.isStatusLine("Ich prüfe die Unterlagen …"))
    #expect(AcknowledgementCopy.isStatusLine("I'm finding the responsible office"))
    #expect(AcknowledgementCopy.isStatusLine("Ich prüfe die Unterlagen für Sie.") == false)
    var cache = AcknowledgementClips()
    #expect(cache.next("de") == nil)
    cache.store(clips, voice: "voice", language: "de")
    #expect([cache.next("de"), cache.next("de"), cache.next("de"), cache.next("de")] == [clips[0], clips[1], clips[2], clips[0]])
    #expect(cache.next("en") == nil)
}

@MainActor
private final class ClipSpy {
    var played: [Data] = []
    var finished = 0
    private var finish: AsyncStream<Void>.Continuation?

    var play: AcknowledgementPlayer {
        { [self] audio, _ in
            played.append(audio)
            let (stream, continuation) = AsyncStream<Void>.makeStream()
            finish = continuation
            for await _ in stream { break }
            finished += 1
        }
    }

    func end() { finish?.yield() }
}

/// Never yields a token, so queued segments never reach ElevenLabs or the Apple fallback voice.
private let hangingToken: VoiceTokenLoader = { _, _ in
    try await Task.sleep(for: .seconds(3600))
    throw CancellationError()
}

@MainActor
private func makePlayback(_ spy: ClipSpy, grace: Duration) -> SpeechPlaybackController {
    let playback = SpeechPlaybackController(loadToken: hangingToken, playClip: spy.play, acknowledgementGrace: grace)
    playback.acknowledgements.store(clips, voice: "voice", language: "de")
    return playback
}

private func segment(index: Int, text: String, language: String = "de") -> SpeechSegment {
    SpeechSegment(actionIDS: [], citations: [], index: index, language: language, text: text, turnID: "turn")
}

@MainActor
private func settle(until condition: () -> Bool) async {
    for _ in 0..<100 where condition() == false { try? await Task.sleep(for: .milliseconds(5)) }
}
