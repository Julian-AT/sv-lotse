import CoreGraphics
import Testing

@testable import LotseVoice

@Test("FR-C1 Apple Speech fallback delivers the final transcript once")
func finalTranscript() {
    var accumulator = TranscriptAccumulator()
    #expect(accumulator.receive("Bitte öffnen", final: false)?.final == false)
    #expect(accumulator.finish() == TranscriptUpdate(text: "Bitte öffnen", final: true))
    #expect(accumulator.receive("Bitte öffnen", final: true) == nil)
    #expect(accumulator.finish() == nil)
}

@Test("FR-C1 empty recognition events do not replace the latest spoken transcript")
func emptyTranscript() {
    var accumulator = TranscriptAccumulator()
    #expect(accumulator.receive("  ", final: false) == nil)
    #expect(accumulator.receive("Bitte öffnen", final: false)?.text == "Bitte öffnen")
    #expect(accumulator.receive("", final: true) == TranscriptUpdate(text: "Bitte öffnen", final: true))
    #expect(accumulator.finish() == nil)
}

@Test("FR-C1 push-to-talk emits one press and one release")
func shortcutTransitions() {
    var shortcut = PushToTalkShortcut()
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: [.maskControl, .maskAlternate]) == .pressed)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: [.maskControl, .maskAlternate]) == .none)
    #expect(shortcut.update(type: .keyDown, keyCode: 12, flags: [.maskControl, .maskAlternate]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: []) == .released)
}

@Test("FR-C1 configurable key releases when a modifier is lifted")
func configuredKey() {
    var shortcut = PushToTalkShortcut(modifiers: [.maskControl], keyCode: 49)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl]) == .pressed)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: []) == .released)
}
