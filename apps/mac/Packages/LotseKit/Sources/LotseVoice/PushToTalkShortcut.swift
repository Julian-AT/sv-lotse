// Adapted from Clicky's BuddyDictationManager.swift. See THIRD_PARTY_NOTICES.md.
import CoreGraphics

public enum ShortcutTransition: Equatable, Sendable { case none, pressed, released, cancelled }

public struct PushToTalkShortcut {
    public let modifiers: CGEventFlags
    public let keyCode: UInt16?
    public private(set) var isPressed = false
    /// Set when another key broke a modifier-only chord; the chord re-arms only after it is let go.
    private var blocked = false

    public init(modifiers: CGEventFlags = [.maskAlternate, .maskCommand], keyCode: UInt16? = nil) {
        self.modifiers = modifiers
        self.keyCode = keyCode
    }

    public mutating func update(
        type: CGEventType, keyCode eventKey: UInt16, flags: CGEventFlags, isAutorepeat: Bool = false
    ) -> ShortcutTransition {
        // VoiceOver reserves Control-Option and can also use Caps Lock. Never intercept those commands.
        let commandModifiers: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift]
        let voiceOver = flags.contains([.maskControl, .maskAlternate]) || flags.contains(.maskAlphaShift)
        let extraModifiers = flags.intersection(commandModifiers).subtracting(modifiers)
        if isPressed && (voiceOver || extraModifiers.isEmpty == false) {
            // Adding a modifier invalidates the hold; only releasing a shortcut key may send.
            isPressed = false
            return .cancelled
        }
        let matches = voiceOver == false && flags.intersection(commandModifiers) == modifiers
        let pressed: Bool
        if let keyCode {
            if matches == false {
                pressed = false
            } else if eventKey == keyCode && type == .keyDown {
                guard isAutorepeat == false else { return .none }
                pressed = true
            } else if eventKey == keyCode && type == .keyUp {
                pressed = false
            } else {
                return .none
            }
        } else {
            guard let chord = updateChord(type: type, flags: flags, matches: matches, voiceOver: voiceOver) else {
                return .none
            }
            if chord == .cancelled { return .cancelled }
            pressed = chord == .pressed
        }
        guard pressed != isPressed else { return .none }
        isPressed = pressed
        return pressed ? .pressed : .released
    }

    /// Modifier-only chord: returns nil for no change, `.cancelled` when another key broke the hold,
    /// otherwise `.pressed`/`.released` as the desired held state.
    private mutating func updateChord(
        type: CGEventType, flags: CGEventFlags, matches: Bool, voiceOver: Bool
    ) -> ShortcutTransition? {
        let commandModifiers: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift]
        let held = flags.intersection(commandModifiers)
        if held.isEmpty {
            blocked = false
        } else if voiceOver || held.subtracting(modifiers).isEmpty == false {
            blocked = true
        }
        if type == .keyDown || type == .keyUp {
            // Any other key while the chord is held is a normal shortcut such as ⌘⌥Esc: never send.
            guard matches else { return nil }
            blocked = true
            guard isPressed else { return nil }
            isPressed = false
            return .cancelled
        }
        guard type == .flagsChanged else { return nil }
        return matches && blocked == false ? .pressed : .released
    }

    public mutating func reset() {
        isPressed = false
        blocked = false
    }
}
