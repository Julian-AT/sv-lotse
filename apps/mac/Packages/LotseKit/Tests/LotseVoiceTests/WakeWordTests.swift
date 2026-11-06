import Foundation
import Testing

@testable import LotseVoice

@Test("wake phrase matches spoken variants case- and diacritic-insensitively", arguments: [
    "Meine SV", "meine sv", "MEINE SV-", "meine S V", "meine es vau", "meine esvau", "Meine Es-Vau,",
    "Hallo, meine S.V. bitte", "meine ess vau", "Meine SV wie beantrage ich Pflegegeld", "méine SV", "Mine SV", "mine es vee"
])
func wakePhraseMatches(text: String) {
    #expect(WakeWordMatcher.matches(text))
}

@Test("wake phrase ignores near misses", arguments: [
    "", "meine", "SV", "meine SV-Nummer", "meine Svenja", "deine SV", "meine Sozialversicherung", "meine es ist"
])
func wakePhraseRejects(text: String) {
    #expect(WakeWordMatcher.matches(text) == false)
}

@Test("strip removes the wake phrase and its punctuation from the question")
func wakePhraseStrip() {
    #expect(WakeWordMatcher.strip("Meine SV, wie beantrage ich Pflegegeld?") == "wie beantrage ich Pflegegeld?")
    #expect(WakeWordMatcher.strip("meine es vau wann kommt mein Bescheid") == "wann kommt mein Bescheid")
    #expect(WakeWordMatcher.strip("Wann kommt mein Bescheid?") == "Wann kommt mein Bescheid?")
    #expect(WakeWordMatcher.strip("Meine SV.") == "")
}

@Test("gate listens only while enabled and no pause reason is held")
func wakeGatePauseResume() {
    var gate = WakeWordGate(enabled: true)
    #expect(gate.state == .listening)
    gate.set(.speechOutput, paused: true)
    gate.set(.pushToTalk, paused: true)
    #expect(gate.state == .paused && gate.shouldListen == false)
    gate.set(.speechOutput, paused: false)
    #expect(gate.state == .paused)
    gate.set(.pushToTalk, paused: false)
    #expect(gate.shouldListen)
    gate.set(.pushToTalk, paused: false)
    #expect(gate.shouldListen)
    gate.enabled = false
    #expect(gate.state == .off && gate.shouldListen == false)
}

@Test("listener reports pause and resume without touching the microphone while paused")
@MainActor
func wakeListenerStates() {
    let listener = WakeWordListener(enabled: false)
    var states: [WakeWordState] = []
    listener.onStateChanged = { states.append($0) }
    listener.set(.speechOutput, paused: true)
    listener.enabled = true
    listener.set(.speechOutput, paused: false)
    listener.set(.capture, paused: true)
    listener.stop()
    #expect(states == [.off, .paused, .listening, .paused, .off])
}

@Test("wake capture finishes after silence and forwards the question without the phrase")
@MainActor
func wakeCaptureSilence() async {
    let provider = WakeProviderSpy()
    let capture = WakeWordCapture(transcription: provider, silence: .milliseconds(50), noSpeech: .seconds(5))
    var outcomes: [WakeWordCapture.Outcome] = []
    capture.onEnded = { outcomes.append($0) }
    capture.begin()
    await waitUntil { provider.starts == 1 }
    #expect(provider.starts == 1)
    #expect(capture.received("Meine SV wie geht", final: false) == "wie geht")
    await waitUntil { provider.finishes == 1 }
    #expect(provider.finishes == 1)
    #expect(capture.received("wie geht es", final: true) == "wie geht es")
    #expect(capture.isActive == false)
    #expect(outcomes == [.sent])
}

@Test("wake capture cancels when nothing is said")
@MainActor
func wakeCaptureNoSpeech() async {
    let provider = WakeProviderSpy()
    let capture = WakeWordCapture(transcription: provider, silence: .seconds(1), noSpeech: .milliseconds(50))
    var outcomes: [WakeWordCapture.Outcome] = []
    capture.onEnded = { outcomes.append($0) }
    capture.begin()
    await waitUntil { provider.cancels == 1 }
    #expect(provider.cancels == 1 && provider.finishes == 0)
    #expect(outcomes == [.cancelled])
}

/// Polls instead of sleeping a fixed time: parallel suites can delay main-actor timers.
@MainActor
private func waitUntil(_ condition: @MainActor () -> Bool) async {
    for _ in 0..<200 where condition() == false { try? await Task.sleep(for: .milliseconds(10)) }
}

@MainActor
private final class WakeProviderSpy: TranscriptionProvider {
    var onTranscript: ((String, Bool) -> Void)?
    var onError: ((Error) -> Void)?
    var starts = 0
    var finishes = 0
    var cancels = 0
    func start(whileHeld: @escaping @MainActor () -> Bool) async throws { starts += 1 }
    func finish() { finishes += 1 }
    func cancel() { cancels += 1 }
}
