// Adapted from Clicky's BuddyDictationManager.swift. See THIRD_PARTY_NOTICES.md.
import CoreGraphics

public enum ShortcutTransition: Equatable, Sendable { case none, pressed, released, cancelled }

public struct PushToTalkShortcut {
    public let modifiers: CGEventFlags
    public let keyCode: UInt16?
    public private(set) var isPressed = false

    public init(modifiers: CGEventFlags = [.maskControl, .maskShift], keyCode: UInt16? = 49) {
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
                // Modifier changes during an existing key hold must not start a new recording.
                guard isAutorepeat == false else { return .none }
                pressed = true
            } else if eventKey == keyCode && type == .keyUp {
                pressed = false
            } else {
                return .none
            }
        } else {
            guard type == .flagsChanged else { return .none }
            pressed = matches
        }
        guard pressed != isPressed else { return .none }
        isPressed = pressed
        return pressed ? .pressed : .released
    }

    public mutating func reset() { isPressed = false }
}
