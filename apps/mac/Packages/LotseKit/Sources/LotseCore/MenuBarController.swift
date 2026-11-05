import AppKit

@MainActor
public final class MenuBarController: NSObject {
    public var openWorkspace: (() -> Void)?
    public var toggleOverlay: (() -> Void)?
    public var enableVoice: (() -> Void)?
    public var checkForUpdates: (() -> Void)?
    public var analyticsConsentChanged: ((Bool) -> Void)?
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let analyticsItem = NSMenuItem(title: "Nutzungsstatistik erlauben", action: #selector(changeConsent), keyEquivalent: "")
    private let preferences: UserDefaults

    public init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        super.init()
        item.button?.image = NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: "SV KI-Lotse")
        item.button?.toolTip = "SV KI-Lotse öffnen"
        let menu = NSMenu()
        for (title, action, key) in [
            ("Arbeitsbereich öffnen", #selector(open), "o"),
            ("Begleitzeiger ein-/ausblenden", #selector(overlay), ""),
            ("Sprechtaste aktivieren (⌃⌥)", #selector(voice), ""),
            ("Nach Updates suchen …", #selector(updates), "")
        ] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = self
            menu.addItem(entry)
        }
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

    @objc private func changeConsent() {
        let optedIn = analyticsItem.state != .on
        analyticsItem.state = optedIn ? .on : .off
        preferences.set(optedIn, forKey: "analyticsOptedIn")
        analyticsConsentChanged?(optedIn)
    }
}
