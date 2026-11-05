import CoreGraphics
import Foundation

/// Holding Option-Command is the default; it avoids VoiceOver's Control-Option and Caps Lock modifiers.
public enum PushToTalkShortcutChoice: String, CaseIterable, Sendable {
    case optionCommand
    case controlShiftSpace
    case optionShiftSpace
    case controlShiftReturn

    public var title: String {
        switch self {
        case .optionCommand: "⌥⌘ gedrückt halten"
        case .controlShiftSpace: "⌃⇧ Leertaste"
        case .optionShiftSpace: "⌥⇧ Leertaste"
        case .controlShiftReturn: "⌃⇧ Eingabetaste"
        }
    }

    public var shortcut: PushToTalkShortcut {
        switch self {
        case .optionCommand: PushToTalkShortcut()
        case .controlShiftSpace: PushToTalkShortcut(modifiers: [.maskControl, .maskShift], keyCode: 49)
        case .optionShiftSpace: PushToTalkShortcut(modifiers: [.maskAlternate, .maskShift], keyCode: 49)
        case .controlShiftReturn: PushToTalkShortcut(modifiers: [.maskControl, .maskShift], keyCode: 36)
        }
    }

    static let migrationKey = "pushToTalkShortcutOptionCommandMigrated"

    /// Moves the old Control-Shift-Space default (or no choice) to ⌥⌘ once; a custom choice is kept.
    public static func load(from preferences: UserDefaults) -> Self {
        let stored = preferences.string(forKey: "pushToTalkShortcut").flatMap(Self.init(rawValue:))
        if preferences.bool(forKey: migrationKey) == false {
            preferences.set(true, forKey: migrationKey)
            if stored == nil || stored == .controlShiftSpace {
                Self.optionCommand.save(to: preferences)
                return .optionCommand
            }
        }
        return stored ?? .optionCommand
    }

    public func save(to preferences: UserDefaults) {
        preferences.set(rawValue, forKey: "pushToTalkShortcut")
    }
}
