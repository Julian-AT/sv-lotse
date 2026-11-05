// Adapted from Clicky's BuddyDictationManager.swift. See THIRD_PARTY_NOTICES.md.
import CoreGraphics

public enum ShortcutTransition: Equatable, Sendable { case none, pressed, released }

public struct PushToTalkShortcut {
    public let modifiers: CGEventFlags
    public let keyCode: UInt16?
    public private(set) var isPressed = false

    public init(modifiers: CGEventFlags = [.maskControl, .maskAlternate], keyCode: UInt16? = nil) {
        self.modifiers = modifiers
        self.keyCode = keyCode
    }

    public mutating func update(type: CGEventType, keyCode eventKey: UInt16, flags: CGEventFlags) -> ShortcutTransition {
        let matches = flags.contains(modifiers)
        let pressed: Bool
        if let keyCode {
            if matches == false {
                pressed = false
            } else if eventKey == keyCode && type == .keyDown {
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
