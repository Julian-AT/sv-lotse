import CoreGraphics
import Foundation

/// Explicit key chords avoid recording on modifier-only prefixes of VoiceOver commands.
/// Control-Shift-Space avoids VoiceOver's Control-Option and Caps Lock modifiers.
public enum PushToTalkShortcutChoice: String, CaseIterable, Sendable {
    case controlShiftSpace
    case optionShiftSpace
    case controlShiftReturn

    public var title: String {
        switch self {
        case .controlShiftSpace: "⌃⇧ Leertaste"
        case .optionShiftSpace: "⌥⇧ Leertaste"
        case .controlShiftReturn: "⌃⇧ Eingabetaste"
        }
    }

    public var shortcut: PushToTalkShortcut {
        switch self {
        case .controlShiftSpace: PushToTalkShortcut()
        case .optionShiftSpace: PushToTalkShortcut(modifiers: [.maskAlternate, .maskShift], keyCode: 49)
        case .controlShiftReturn: PushToTalkShortcut(modifiers: [.maskControl, .maskShift], keyCode: 36)
        }
    }

    public static func load(from preferences: UserDefaults) -> Self {
        preferences.string(forKey: "pushToTalkShortcut").flatMap(Self.init(rawValue:)) ?? .controlShiftSpace
    }

    public func save(to preferences: UserDefaults) {
        preferences.set(rawValue, forKey: "pushToTalkShortcut")
    }
}
