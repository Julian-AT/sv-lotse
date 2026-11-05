import CoreGraphics
import Foundation
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
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: [.maskControl, .maskShift]) == .none)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl, .maskShift]) == .pressed)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl, .maskShift]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: []) == .released)
}

@Test("FR-C1 configurable key releases when a modifier is lifted")
func configuredKey() {
    var shortcut = PushToTalkShortcut(modifiers: [.maskControl], keyCode: 49)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl]) == .pressed)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 0, flags: []) == .released)
}

@Test("FR-C1 VoiceOver command sequences never start recording")
func voiceOverCommands() {
    for choice in PushToTalkShortcutChoice.allCases {
        var shortcut = choice.shortcut
        for flags: CGEventFlags in [
            [.maskControl, .maskAlternate], [.maskControl, .maskAlternate, .maskShift],
            [.maskControl, .maskAlternate, .maskCommand], [.maskAlphaShift]
        ] {
            #expect(shortcut.update(type: .flagsChanged, keyCode: 59, flags: flags) == .none)
            for key: UInt16 in [0, 36, 49, 96, 123, 124] {
                #expect(shortcut.update(type: .keyDown, keyCode: key, flags: flags) == .none)
                #expect(shortcut.update(type: .keyUp, keyCode: key, flags: flags) == .none)
            }
            #expect(shortcut.update(type: .flagsChanged, keyCode: 59, flags: []) == .none)
        }
        #expect(shortcut.isPressed == false)
    }
    // Even a legacy caller configuring Control-Option must not intercept VoiceOver.
    var legacy = PushToTalkShortcut(modifiers: [.maskControl, .maskAlternate])
    #expect(legacy.update(type: .flagsChanged, keyCode: 58, flags: [.maskControl, .maskAlternate]) == .none)
}

@Test("FR-C1 shortcuts require exact command modifiers and tolerate unrelated event flags")
func exactShortcutModifiers() {
    var shortcut = PushToTalkShortcut()
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl, .maskShift, .maskCommand]) == .none)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl, .maskShift, .maskNumericPad]) == .pressed)
    #expect(shortcut.update(type: .keyUp, keyCode: 49, flags: [.maskControl, .maskShift]) == .released)
}

@Test("FR-C1 releasing a VoiceOver modifier cannot start recording from autorepeat")
func voiceOverModifierReleaseIgnoresAutorepeat() {
    for choice in PushToTalkShortcutChoice.allCases {
        var shortcut = choice.shortcut
        let key = choice == .controlShiftReturn ? UInt16(36) : UInt16(49)
        let voiceOverFlags = shortcut.modifiers.union([.maskControl, .maskAlternate])
        #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: voiceOverFlags) == .none)
        #expect(shortcut.update(type: .keyDown, keyCode: key, flags: voiceOverFlags) == .none)
        #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: shortcut.modifiers) == .none)
        for _ in 0..<3 {
            #expect(shortcut.update(
                type: .keyDown, keyCode: key, flags: shortcut.modifiers, isAutorepeat: true
            ) == .none)
            #expect(shortcut.isPressed == false)
        }
        #expect(shortcut.update(type: .keyUp, keyCode: key, flags: shortcut.modifiers) == .none)
        #expect(shortcut.update(type: .keyDown, keyCode: key, flags: shortcut.modifiers) == .pressed)
        #expect(shortcut.update(
            type: .keyDown, keyCode: key, flags: shortcut.modifiers, isAutorepeat: true
        ) == .none)
        #expect(shortcut.update(type: .keyUp, keyCode: key, flags: shortcut.modifiers) == .released)
    }
}

@Test("FR-C1 shortcut preferences restore user choices and fall back safely for unknown values")
func shortcutPreferences() throws {
    let suite = "lotse-voice-shortcut-test-\(UUID())"
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    #expect(PushToTalkShortcutChoice.load(from: preferences) == .controlShiftSpace)
    for choice in PushToTalkShortcutChoice.allCases {
        choice.save(to: preferences)
        let restored = try #require(UserDefaults(suiteName: suite))
        #expect(PushToTalkShortcutChoice.load(from: restored) == choice)
    }
    preferences.set("control-option", forKey: "pushToTalkShortcut")
    #expect(PushToTalkShortcutChoice.load(from: preferences) == .controlShiftSpace)
}
