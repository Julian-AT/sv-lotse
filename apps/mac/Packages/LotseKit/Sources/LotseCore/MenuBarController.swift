import AppKit
import LotseVoice

@MainActor
public final class MenuBarController: NSObject {
    public var openWorkspace: (() -> Void)?
    public var toggleOverlay: (() -> Void)?
    public var enableVoice: (() -> Void)?
    public var checkForUpdates: (() -> Void)?
    public var analyticsConsentChanged: ((Bool) -> Void)?
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let analyticsItem = NSMenuItem(title: "Nutzungsstatistik erlauben", action: #selector(changeConsent), keyEquivalent: "")
    public var shortcutChanged: ((PushToTalkShortcutChoice) -> Void)?
    public private(set) var shortcutChoice: PushToTalkShortcutChoice
    let shortcutMenu = NSMenu(title: "Sprechtaste auswählen")
    private let voiceItem = NSMenuItem(title: "", action: #selector(voice), keyEquivalent: "")
    private let preferences: UserDefaults

    public init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        shortcutChoice = .load(from: preferences)
        super.init()
        item.button?.image = NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: "SV KI-Lotse")
        item.button?.toolTip = "SV KI-Lotse öffnen"
        let menu = NSMenu()
        for (title, action, key) in [
            ("Arbeitsbereich öffnen", #selector(open), "o"),
            ("Begleitzeiger ein-/ausblenden", #selector(overlay), ""),
            ("Nach Updates suchen …", #selector(updates), "")
        ] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = self
            menu.addItem(entry)
        }
        voiceItem.target = self
        menu.insertItem(voiceItem, at: 2)
        let settings = NSMenuItem(title: "Sprechtaste auswählen", action: nil, keyEquivalent: "")
        settings.submenu = shortcutMenu
        for choice in PushToTalkShortcutChoice.allCases {
            let entry = NSMenuItem(title: choice.title, action: #selector(changeShortcut(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = choice.rawValue
            shortcutMenu.addItem(entry)
        }
        menu.insertItem(settings, at: 3)
        updateShortcutItems()
        analyticsItem.target = self
        analyticsItem.state = preferences.bool(forKey: "analyticsOptedIn") ? .on : .off
        menu.addItem(analyticsItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
    }

    @objc private func open() { openWorkspace?() }
    @objc private func overlay() { toggleOverlay?() }
    @objc private func voice() { enableVoice?() }
    @objc private func updates() { checkForUpdates?() }

    @objc private func changeShortcut(_ sender: NSMenuItem) {
        guard let rawValue = sender.representedObject as? String,
            let choice = PushToTalkShortcutChoice(rawValue: rawValue)
        else { return }
        shortcutChoice = choice
        choice.save(to: preferences)
        updateShortcutItems()
        shortcutChanged?(choice)
    }

    private func updateShortcutItems() {
        voiceItem.title = "Sprechtaste aktivieren (\(shortcutChoice.title))"
        for entry in shortcutMenu.items {
            entry.state = (entry.representedObject as? String) == shortcutChoice.rawValue ? .on : .off
        }
    }

    @objc private func changeConsent() {
        let optedIn = analyticsItem.state != .on
        analyticsItem.state = optedIn ? .on : .off
        preferences.set(optedIn, forKey: "analyticsOptedIn")
        analyticsConsentChanged?(optedIn)
    }
}
