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
    var shortcut = PushToTalkShortcutChoice.controlShiftSpace.shortcut
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
    var legacy = PushToTalkShortcut(modifiers: [.maskControl, .maskAlternate])
    #expect(legacy.update(type: .flagsChanged, keyCode: 58, flags: [.maskControl, .maskAlternate]) == .none)
}

@Test("FR-C1 shortcuts require exact command modifiers and tolerate unrelated event flags")
func exactShortcutModifiers() {
    var shortcut = PushToTalkShortcutChoice.controlShiftSpace.shortcut
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl, .maskShift, .maskCommand]) == .none)
    #expect(shortcut.update(type: .keyDown, keyCode: 49, flags: [.maskControl, .maskShift, .maskNumericPad]) == .pressed)
    #expect(shortcut.update(type: .keyUp, keyCode: 49, flags: [.maskControl, .maskShift]) == .released)
}

@Test("FR-C1 releasing a VoiceOver modifier cannot start recording from autorepeat")
func voiceOverModifierReleaseIgnoresAutorepeat() {
    for choice in PushToTalkShortcutChoice.allCases {
        var shortcut = choice.shortcut
        // Modifier-only chords have no key to autorepeat; optionCommandChord covers them.
        guard shortcut.keyCode != nil else { continue }
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
    #expect(PushToTalkShortcutChoice.load(from: preferences) == .optionCommand)
    for choice in PushToTalkShortcutChoice.allCases {
        choice.save(to: preferences)
        let restored = try #require(UserDefaults(suiteName: suite))
        #expect(PushToTalkShortcutChoice.load(from: restored) == choice)
    }
    preferences.set("control-option", forKey: "pushToTalkShortcut")
    #expect(PushToTalkShortcutChoice.load(from: preferences) == .optionCommand)
}

@Test("Push-to-talk migrates the old Control-Shift-Space default to ⌥⌘ once and keeps custom choices")
func shortcutMigration() throws {
    let suite = "lotse-voice-shortcut-migration-\(UUID())"
    let preferences = try #require(UserDefaults(suiteName: suite))
    defer { preferences.removePersistentDomain(forName: suite) }
    PushToTalkShortcutChoice.controlShiftSpace.save(to: preferences)
    #expect(PushToTalkShortcutChoice.load(from: preferences) == .optionCommand)
    PushToTalkShortcutChoice.controlShiftSpace.save(to: preferences)
    #expect(PushToTalkShortcutChoice.load(from: preferences) == .controlShiftSpace)
    let custom = "lotse-voice-shortcut-custom-\(UUID())"
    let customPreferences = try #require(UserDefaults(suiteName: custom))
    defer { customPreferences.removePersistentDomain(forName: custom) }
    PushToTalkShortcutChoice.optionShiftSpace.save(to: customPreferences)
    #expect(PushToTalkShortcutChoice.load(from: customPreferences) == .optionShiftSpace)
}

@Test("⌥⌘ chord starts on hold, sends on release and cancels when another key is pressed")
func optionCommandChord() {
    var shortcut = PushToTalkShortcut()
    let chord: CGEventFlags = [.maskAlternate, .maskCommand]
    #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: [.maskAlternate]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: chord) == .pressed)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: [.maskAlternate]) == .released)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: []) == .none)

    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: chord) == .pressed)
    #expect(shortcut.update(type: .keyDown, keyCode: 53, flags: chord) == .cancelled)
    #expect(shortcut.update(type: .keyUp, keyCode: 53, flags: chord) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: [.maskAlternate]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: chord) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: []) == .none)

    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: [.maskCommand, .maskShift]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: [.maskCommand, .maskShift, .maskAlternate]) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 56, flags: chord) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 58, flags: []) == .none)
    #expect(shortcut.update(type: .flagsChanged, keyCode: 55, flags: chord) == .pressed)
}

@Test("A modifier-only press waits for the hold delay; a quick tap is swallowed")
func holdGate() {
    var gate = ShortcutHoldGate()
    #expect(gate.receive(.pressed) == .none)
    #expect(gate.isPending)
    #expect(gate.receive(.released) == .none)
    #expect(gate.confirm() == .none)
    #expect(gate.receive(.pressed) == .none)
    #expect(gate.confirm() == .pressed)
    #expect(gate.receive(.released) == .released)
    #expect(gate.receive(.pressed) == .none)
    #expect(gate.confirm() == .pressed)
    #expect(gate.receive(.cancelled) == .cancelled)
}
