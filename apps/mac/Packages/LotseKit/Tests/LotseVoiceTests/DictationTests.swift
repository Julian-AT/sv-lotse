import AppKit
import CoreGraphics
import Foundation
import Testing

@testable import LotseVoice

@Test("FR-C8 the second shortcut is distinct from conversation keys and excludes VoiceOver")
func dictationKey() {
    var shortcut = VoiceConfiguration.dictationShortcut
    for choice in PushToTalkShortcutChoice.allCases {
        #expect(shortcut.keyCode != choice.shortcut.keyCode || shortcut.modifiers != choice.shortcut.modifiers)
    }
    #expect(shortcut.update(type: .keyDown, keyCode: 2, flags: [.maskControl, .maskAlternate, .maskShift]) == .none)
    #expect(shortcut.update(type: .keyDown, keyCode: 2, flags: [.maskControl, .maskShift]) == .pressed)
    #expect(shortcut.update(type: .keyUp, keyCode: 2, flags: [.maskControl, .maskShift]) == .released)
}

@Test("FR-C8 interrupted shortcut monitoring cancels a hold instead of inserting", arguments: [false, true])
@MainActor
func interruptedDictationMonitor(stopping: Bool) throws {
    let monitor = GlobalPushToTalkShortcutMonitor(shortcut: VoiceConfiguration.dictationShortcut)
    var transitions: [ShortcutTransition] = []
    monitor.onTransition = { transitions.append($0) }
    let event = try #require(CGEvent(keyboardEventSource: nil, virtualKey: 2, keyDown: true))
    event.flags = [.maskControl, .maskShift]
    monitor.handle(type: .keyDown, event: event)
    if stopping { monitor.stop() } else { monitor.handle(type: .tapDisabledByTimeout, event: event) }
    #expect(transitions == [.pressed, .cancelled])
    monitor.stop()
}

@Test("FR-C8 provider partials never insert; release inserts one final transcript into the captured field")
@MainActor
func dictationInsertsOnRelease() async throws {
    let harness = DictationHarness()
    harness.controller.handle(.pressed)
    let input = await harness.nextInput()
    input.report("Bitte öffnen", final: false)
    #expect(harness.target.insertions.isEmpty)
    input.report("  Bitte öffnen Sie das Dokument.  ", final: true)
    #expect(harness.target.insertions.isEmpty)
    harness.controller.handle(.released)
    await harness.target.inserted.wait()
    input.report("Late duplicate", final: true)
    #expect(harness.target.insertions == ["Bitte öffnen Sie das Dokument."])
    #expect(harness.captureCount == 1)
    #expect(harness.errors.isEmpty)
    harness.controller.cancel()
}

@Test("FR-C8 cancelling a dictation discards text and never inserts on a late final")
@MainActor
func cancelDictation() async {
    let harness = DictationHarness()
    harness.controller.handle(.pressed)
    let input = await harness.nextInput()
    input.report("Entwurf", final: false)
    harness.controller.cancel()
    harness.controller.handle(.released)
    input.report("Entwurf", final: true)
    #expect(harness.target.insertions.isEmpty)
    #expect(input.cancelled)
}

@Test("FR-C8 releasing before recording starts and empty speech allow the next dictation")
@MainActor
func emptyDictationCanRestart() async {
    let harness = DictationHarness()
    harness.controller.handle(.pressed)
    harness.controller.handle(.released)
    harness.controller.handle(.pressed)
    let input = await harness.nextInput()
    harness.controller.handle(.released)
    input.report("", final: true)
    harness.controller.handle(.pressed)
    #expect(harness.captureCount == 3)
    #expect(harness.target.insertions.isEmpty)
    harness.controller.cancel()
}

@Test("FR-C8 a changed focus rejects insertion and reports failure without rerouting text")
@MainActor
func focusChangeRejectsDictation() async {
    let harness = DictationHarness()
    harness.target.failure = DictationInsertionError.focusChanged
    harness.controller.handle(.pressed)
    let input = await harness.nextInput()
    harness.controller.handle(.released)
    input.report("Entwurf", final: true)
    await harness.errorReported.wait()
    #expect(harness.errors.count == 1)
    #expect(harness.target.insertions.isEmpty)
    harness.controller.cancel()
}

@Test("FR-C8 dictation cannot acquire a microphone without an editable target")
@MainActor
func noTargetRejectsRecording() {
    var providerCreated = false
    var failure: Error?
    let controller = DictationController(makeTranscription: {
        providerCreated = true
        return AppleSpeechTranscriptionProvider()
    }, captureTarget: { throw DictationInsertionError.noEditableField })
    controller.onError = { failure = $0 }
    controller.handle(.pressed)
    #expect(providerCreated == false)
    #expect(failure != nil)
    controller.cancel()
}

@MainActor
private final class DictationHarness {
    let target = DictationTargetSpy()
    let inputReady = DictationSignal()
    let errorReported = DictationSignal()
    var input: DictationInputSpy?
    var errors: [Error] = []
    var captureCount = 0

    lazy var controller: DictationController = {
        let controller = DictationController(makeTranscription: { [self] in
            AppleSpeechTranscriptionProvider(
                requestMicrophoneAccess: { true }, requestSpeechAuthorization: { true },
                makeInput: { [self] handler in
                    let input = DictationInputSpy(handler: handler)
                    self.input = input
                    inputReady.signal()
                    return input
                }
            )
        }, captureTarget: { [self] in captureCount += 1; return target })
        controller.onError = { [self] in errors.append($0); errorReported.signal() }
        return controller
    }()

    func nextInput() async -> DictationInputSpy {
        await inputReady.wait()
        guard let input else { preconditionFailure("Input signal must follow creation") }
        return input
    }
}

@MainActor
private final class DictationTargetSpy: DictationTextTarget {
    var insertions: [String] = []
    var failure: Error?
    let inserted = DictationSignal()
    func insert(_ text: String) async throws {
        if let failure { throw failure }
        insertions.append(text)
        inserted.signal()
    }
}

@MainActor
private final class DictationInputSpy: SpeechRecognitionInput {
    let handler: SpeechRecognitionHandler
    var cancelled = false
    init(handler: @escaping SpeechRecognitionHandler) { self.handler = handler }
    func finish() {}
    func cancel() { cancelled = true }
    func report(_ text: String, final: Bool) { handler(.init(text: text, final: final, failed: false)) }
}

@MainActor
private final class DictationSignal {
    private let stream: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation
    init() { (stream, continuation) = AsyncStream.makeStream() }
    func signal() { continuation.yield(()) }
    func wait() async { for await _ in stream { return } }
}
