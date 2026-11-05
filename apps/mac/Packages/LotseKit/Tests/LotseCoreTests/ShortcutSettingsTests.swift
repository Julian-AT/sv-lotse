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
        #expect(menu.shortcutChoice == .controlShiftSpace)
        var selected: PushToTalkShortcutChoice?
        menu.shortcutChanged = { selected = $0 }
        menu.shortcutMenu.performActionForItem(at: 1)
        #expect(selected == .optionShiftSpace)
        let restored = MenuBarController(preferences: preferences)
        #expect(restored.shortcutChoice == .optionShiftSpace)
        #expect(restored.shortcutMenu.item(at: 1)?.state == .on)
        #expect(restored.shortcutMenu.item(at: 0)?.state == .off)
        preferences.set("control-option", forKey: "pushToTalkShortcut")
        #expect(MenuBarController(preferences: preferences).shortcutChoice == .controlShiftSpace)
    }
}
