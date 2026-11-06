import AppKit
import Foundation
import LotseVoice
import Testing

@testable import LotseCore

@Suite(.serialized) @MainActor
struct ShortcutSettingsTests {
    @Test("FR-C1 menu selection persists the shortcut and restores its checked state")
    func persistMenuShortcut() throws {
        _ = NSApplication.shared
        let suite = "lotse-shortcut-test-\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let menu = MenuBarController(preferences: preferences)
        #expect(menu.shortcutChoice == .optionCommand)
        var selected: PushToTalkShortcutChoice?
        menu.shortcutChanged = { selected = $0 }
        menu.shortcutMenu.performActionForItem(at: 2)
        #expect(selected == .optionShiftSpace)
        let restored = MenuBarController(preferences: preferences)
        #expect(restored.shortcutChoice == .optionShiftSpace)
        #expect(restored.shortcutMenu.item(at: 2)?.state == .on)
        #expect(restored.shortcutMenu.item(at: 0)?.state == .off)
        preferences.set("control-option", forKey: "pushToTalkShortcut")
        #expect(MenuBarController(preferences: preferences).shortcutChoice == .optionCommand)
    }

    @Test("FR-C4 speech speed menu persists and restores the selected playback rate")
    func persistSpeechSpeed() throws {
        _ = NSApplication.shared
        let suite = "lotse-speech-speed-test-\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let menu = MenuBarController(preferences: preferences)
        var selected: Double?
        menu.speechSpeedChanged = { selected = $0 }
        menu.speechSpeedMenu.performActionForItem(at: 0)
        #expect(selected == 0.5)
        let restored = MenuBarController(preferences: preferences)
        #expect(restored.speechSpeedMenu.item(at: 0)?.state == .on)
        #expect(restored.speechSpeedMenu.item(at: 2)?.state == .off)
    }

    @Test("FR-L4 cursor menu choices persist and restore their checked state")
    func persistCursorSettings() throws {
        _ = NSApplication.shared
        let suite = "lotse-cursor-test-\(UUID())"
        let preferences = try #require(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let menu = MenuBarController(preferences: preferences)
        menu.cursorSizeMenu.performActionForItem(at: 2)
        menu.cursorSpeedMenu.performActionForItem(at: 0)
        let restored = MenuBarController(preferences: preferences)
        #expect(restored.cursorSizeMenu.item(at: 2)?.state == .on)
        #expect(restored.cursorSpeedMenu.item(at: 0)?.state == .on)
        #expect(restored.cursorSizeMenu.item(at: 0)?.state == .off)
        restored.setLanguage(.english)
        #expect(restored.cursorSizeMenu.items.count == menu.cursorSizeMenu.items.count)
        #expect(restored.cursorSpeedMenu.items.count == menu.cursorSpeedMenu.items.count)
    }
}
