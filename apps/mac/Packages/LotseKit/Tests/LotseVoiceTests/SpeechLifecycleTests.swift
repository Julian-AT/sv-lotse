import Foundation
import Testing

@testable import LotseVoice

@Test("FR-C1 release before the start task runs never requests permission or records")
@MainActor
func releaseBeforeStart() async {
    let harness = SpeechHarness()
    var permissionRequests = 0
    harness.microphoneAccess = { permissionRequests += 1; return true }
    let controller = PushToTalkController(transcription: harness.provider)
    controller.handle(.pressed)
    let pendingStart = controller.startTask
    controller.handle(.released)
    await pendingStart?.value
    #expect(permissionRequests == 0)
    #expect(harness.inputs.isEmpty)
    controller.cancel()
}

@Test("FR-C1 release during either permission await prevents recording", arguments: [false, true])
@MainActor
func releaseDuringPermission(speechPermission: Bool) async {
    let requested = SpeechTestSignal()
    let granted = SpeechTestSignal()
    let returned = SpeechTestSignal()
    let harness = SpeechHarness()
    let permission: @MainActor () async -> Bool = {
        requested.signal()
        await granted.wait()
        returned.signal()
        return true
    }
    if speechPermission { harness.speechAuthorization = permission } else { harness.microphoneAccess = permission }
    let controller = PushToTalkController(transcription: harness.provider)
    controller.onError = { harness.errors.append($0) }
    controller.handle(.pressed)
    let pendingStart = controller.startTask
    await requested.wait()
    controller.handle(.released)
    granted.signal()
    await returned.wait()
    await pendingStart?.value
    #expect(harness.inputs.isEmpty)
    #expect(harness.errors.isEmpty)
    controller.cancel()
}

@Test("FR-C1 an old permission response cannot start recording during a newer hold")
@MainActor
func permissionFromPreviousHold() async throws {
    let requested = SpeechTestSignal()
    let granted = SpeechTestSignal()
    let returned = SpeechTestSignal()
    let started = SpeechTestSignal()
    let harness = SpeechHarness()
    var requests = 0
    harness.microphoneAccess = {
        requests += 1
        if requests == 1 {
            requested.signal()
            await granted.wait()
            returned.signal()
        }
        return true
    }
    harness.onInput = { started.signal() }
    let controller = PushToTalkController(transcription: harness.provider)
    controller.handle(.pressed)
    let previousStart = controller.startTask
    await requested.wait()
    controller.handle(.released)
    controller.handle(.pressed)
    await started.wait()
    let input = try #require(harness.inputs.first)
    granted.signal()
    await returned.wait()
    await previousStart?.value
    #expect(harness.inputs.count == 1)
    #expect(input.cancelCount == 0)
    controller.handle(.released)
    #expect(input.finishCount == 1)
    controller.cancel()
}

@Test("FR-C1 a hold must still be active after each permission await", arguments: [false, true])
@MainActor
func holdCheckAfterPermission(speechPermission: Bool) async {
    let requested = SpeechTestSignal()
    let granted = SpeechTestSignal()
    let harness = SpeechHarness()
    var held = true
    let permission: @MainActor () async -> Bool = {
        requested.signal()
        await granted.wait()
        return true
    }
    if speechPermission { harness.speechAuthorization = permission } else { harness.microphoneAccess = permission }
    let start = Task { @MainActor in try await harness.provider.start(whileHeld: { held }) }
    await requested.wait()
    held = false
    granted.signal()
    do {
        try await start.value
        Issue.record("A released hold must cancel the pending start")
    } catch is CancellationError {
        #expect(harness.inputs.isEmpty)
    } catch {
        Issue.record("Unexpected start error: \(error)")
    }
    harness.provider.cancel()
}

@Test("FR-C1 a released utterance survives the next press and delivers one final transcript")
@MainActor
func releasedUtteranceSurvivesNextPress() async throws {
    let harness = SpeechHarness()
    try await harness.provider.start()
    let first = try #require(harness.inputs.first)
    first.report(text: "Bitte öffnen", final: false)
    harness.provider.finish()
    try await harness.provider.start()
    let second = try #require(harness.inputs.last)
    #expect(first.finishCount == 1)
    #expect(first.cancelCount == 0)
    first.report(text: "Bitte öffnen Sie", final: true)
    first.report(text: "Bitte öffnen Sie", final: true)
    #expect(harness.updates.filter(\.final) == [TranscriptUpdate(text: "Bitte öffnen Sie", final: true)])
    #expect(second.cancelCount == 0)
    second.report(text: "Den Arbeitsbereich", final: false)
    harness.provider.finish()
    second.report(text: "Den Arbeitsbereich", final: true)
    #expect(harness.updates.filter(\.final).map(\.text) == ["Bitte öffnen Sie", "Den Arbeitsbereich"])
    harness.provider.cancel()
}

@Test("FR-C1 an older released utterance finalizes independently on fallback or error", arguments: [false, true])
@MainActor
func releasedUtteranceFallback(failed: Bool) async throws {
    let fallback = SpeechTestSignal()
    let delivered = SpeechTestSignal()
    let harness = SpeechHarness()
    harness.waitForFinal = { await fallback.wait() }
    harness.onFinal = { delivered.signal() }
    try await harness.provider.start()
    let first = try #require(harness.inputs.first)
    first.report(text: "Bitte öffnen", final: false)
    harness.provider.finish()
    try await harness.provider.start()
    let second = try #require(harness.inputs.last)
    try #require(first.cancelCount == 0)
    if failed { first.report(text: nil, final: false, failed: true) } else { fallback.signal() }
    await delivered.wait()
    first.report(text: "Bitte öffnen", final: true)
    #expect(harness.updates.filter(\.final) == [TranscriptUpdate(text: "Bitte öffnen", final: true)])
    #expect(harness.errors.isEmpty)
    #expect(second.cancelCount == 0)
    #expect(first.cancelCount == 1)
    harness.provider.cancel()
}

@Test("FR-C1 stopping voice cancels both recording and finalizing sessions")
@MainActor
func cancelAllSpeechSessions() async throws {
    let harness = SpeechHarness()
    try await harness.provider.start()
    let first = try #require(harness.inputs.first)
    first.report(text: "Bitte öffnen", final: false)
    harness.provider.finish()
    try await harness.provider.start()
    let second = try #require(harness.inputs.last)
    harness.provider.cancel()
    first.report(text: "Bitte öffnen", final: true)
    second.report(text: "Den Arbeitsbereich", final: true)
    #expect(first.cancelCount == 1)
    #expect(second.cancelCount == 1)
    #expect(harness.updates.filter(\.final).isEmpty)
}

@MainActor
private final class SpeechHarness {
    var microphoneAccess: @MainActor () async -> Bool = { true }
    var speechAuthorization: @MainActor () async -> Bool = { true }
    var waitForFinal: @MainActor () async throws -> Void = { try await Task.sleep(for: .seconds(60)) }
    var inputs: [SpeechInputSpy] = []
    var updates: [TranscriptUpdate] = []
    var errors: [Error] = []
    var onInput: (() -> Void)?
    var onFinal: (() -> Void)?

    lazy var provider: AppleSpeechTranscriptionProvider = {
        let provider = AppleSpeechTranscriptionProvider(
            requestMicrophoneAccess: { [weak self] in await self?.microphoneAccess() ?? false },
            requestSpeechAuthorization: { [weak self] in await self?.speechAuthorization() ?? false },
            makeInput: { [weak self] handler in
                guard let self else { throw TranscriptionError.unavailable }
                let input = SpeechInputSpy(handler: handler)
                self.inputs.append(input)
                self.onInput?()
                return input
            },
            waitForFinal: { [weak self] in try await self?.waitForFinal() }
        )
        provider.onTranscript = { [weak self] text, final in
            self?.updates.append(TranscriptUpdate(text: text, final: final))
            if final { self?.onFinal?() }
        }
        provider.onError = { [weak self] in self?.errors.append($0) }
        return provider
    }()
}

@MainActor
private final class SpeechInputSpy: SpeechRecognitionInput {
    let handler: SpeechRecognitionHandler
    var finishCount = 0
    var cancelCount = 0

    init(handler: @escaping SpeechRecognitionHandler) { self.handler = handler }
    func finish() { finishCount += 1 }
    func cancel() { cancelCount += 1 }
    func report(text: String?, final: Bool, failed: Bool = false) {
        handler(SpeechRecognitionEvent(text: text, final: final, failed: failed))
    }
}

@MainActor
private final class SpeechTestSignal {
    private let stream: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation

    init() { (stream, continuation) = AsyncStream.makeStream() }
    func signal() { continuation.yield(()) }
    func wait() async { for await _ in stream { return } }
}
