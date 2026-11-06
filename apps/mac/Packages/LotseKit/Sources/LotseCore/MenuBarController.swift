import AppKit
import LotseImport
import LotseOverlay
import LotseVoice

public enum CompanionWorkspaceStatus: Sendable { case connecting, connected, unavailable }

@MainActor
public final class MenuBarController: NSObject, NSMenuDelegate {
    public var newChat: (() -> Void)?
    public var checkSetup: (() -> Void)?
    public var giveFeedback: (() -> Void)?
    public var showHelp: (() -> Void)?
    public var restartApp: (() -> Void)?
    public var openWorkspace: (() -> Void)?
    public var openSettings: (() -> Void)?
    public var openSetup: (() -> Void)?
    public var openRelatives: (() -> Void)?
    public var toggleOverlay: (() -> Void)?
    public var circleToAsk: (() -> Void)?
    public var cancelCircle: (() -> Void)?
    public var enableVoice: (() -> Void)?
    public var checkForUpdates: (() -> Void)?
    public var analyticsConsentChanged: ((Bool) -> Void)?
    public var refreshStatus: (() -> Void)?
    public var speechSpeedChanged: ((Double) -> Void)?
    public var wakeWordChanged: ((Bool) -> Void)?
    private let wakeWordItem = NSMenuItem(title: "", action: #selector(toggleWakeWord), keyEquivalent: "")
    private var wakeWordState = WakeWordState.off
    private lazy var baseStatusImage = LotseBrand.statusImage(description: copy.appName)
    let speechSpeedMenu = NSMenu()
    public var shortcutChanged: ((PushToTalkShortcutChoice) -> Void)?
    public var openImport: (() -> Void)?
    public var importDocuments: ((NSPasteboard) -> Bool)?
    private let uploadStatusItem = NSMenuItem()
    public private(set) var shortcutChoice: PushToTalkShortcutChoice
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let analyticsItem = NSMenuItem(title: "", action: #selector(changeConsent), keyEquivalent: "")
    let shortcutMenu = NSMenu()
    let statusItem = NSMenuItem()
    let voiceStatusItem = NSMenuItem()
    private let relativesItem = NSMenuItem(title: "", action: #selector(relatives), keyEquivalent: "")
    private var sharingActive = false
    private let voiceItem = NSMenuItem(title: "", action: #selector(voice), keyEquivalent: "")
    let cursorSizeMenu = NSMenu(title: OverlayCopy.sizeTitle)
    let cursorSpeedMenu = NSMenu(title: OverlayCopy.speedTitle)
    private let reducedMotionItem = NSMenuItem(title: OverlayCopy.reducedMotion, action: #selector(changeMotion), keyEquivalent: "")
    var nativeMenu: NSMenu? { item.menu }
    private let preferences: UserDefaults
    private var copy = CompanionCopy()
    private var voiceEnabled = false
    private var workspaceStatus = CompanionWorkspaceStatus.connecting
    private var voiceAvailable = false
    private var recording = false

    public init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        shortcutChoice = .load(from: preferences)
        super.init()
        copy.language = .load(from: preferences)
        item.button?.image = LotseBrand.statusImage(description: copy.appName)
        item.button?.toolTip = copy.appName
        buildMenu()
    }

    public func setLanguage(_ language: CompanionLanguage) {
        copy.language = language
        buildMenu()
    }

    public func updateStatus(workspace: CompanionWorkspaceStatus, voiceEnabled: Bool, voiceAvailable: Bool, recording: Bool) {
        workspaceStatus = workspace
        self.voiceEnabled = voiceEnabled
        self.voiceAvailable = voiceAvailable
        self.recording = recording
        let chrome = ChromeCopy(language: copy.language)
        statusItem.title = workspace == .connected ? (voiceEnabled ? chrome.running : chrome.paused) : chrome.disconnected
        statusItem.isEnabled = false
        statusItem.image = statusDot(connected: workspace == .connected)
        if recording { voiceStatusItem.title = copy.listening } else if voiceEnabled {
            voiceStatusItem.title = voiceAvailable ? copy.voiceReady : copy.voiceNeedsPermission
        } else { voiceStatusItem.title = copy.voiceOff }
        item.button?.toolTip = "\(copy.appName) — \(statusItem.title) — \(voiceStatusItem.title)"
        updateShortcutItems()
        updateWakeWord(wakeWordState)
    }

    /// Shows the wake-word toggle and a small dot on the menu-bar icon while „Meine SV“ is awaited.
    public func updateWakeWord(_ state: WakeWordState) {
        wakeWordState = state
        let german = copy.language == .german
        wakeWordItem.title = WakeWordPreferences.title(german: german)
        wakeWordItem.state = WakeWordPreferences.enabled(in: preferences) ? .on : .off
        wakeWordItem.image = NSImage(systemSymbolName: "waveform.badge.mic", accessibilityDescription: nil)
        guard let base = baseStatusImage else { return }
        guard state == .listening, recording == false else {
            item.button?.image = base
            return
        }
        let waiting = WakeWordPreferences.waiting(german: german)
        let image = NSImage(size: base.size, flipped: false) { rect in
            base.draw(in: rect)
            NSBezierPath(ovalIn: NSRect(x: rect.maxX - 4, y: rect.minY, width: 4, height: 4)).fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "\(copy.appName) — \(waiting)"
        item.button?.image = image
        item.button?.toolTip = "\(copy.appName) — \(statusItem.title) — \(waiting)"
    }

    public func setWakeWordEnabled(_ enabled: Bool) {
        preferences.set(enabled, forKey: WakeWordPreferences.enabledKey)
        updateWakeWord(wakeWordState)
        wakeWordChanged?(enabled)
    }

    @objc private func toggleWakeWord() { setWakeWordEnabled(WakeWordPreferences.enabled(in: preferences) == false) }

    public func menuWillOpen(_ menu: NSMenu) { refreshStatus?() }

    public func updateUploadStatus(_ status: UploadQueueStatus, count: Int) {
        uploadStatusItem.title = ImportCopy(english: copy.language == .english).status(status, count: count)
    }

    public func setSharingActive(_ active: Bool) {
        sharingActive = active
        relativesItem.title = active ? copy.relativesActive : copy.relatives
    }

    private func buildMenu() {
        item.menu?.removeAllItems()
        let chrome = ChromeCopy(language: copy.language)
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        menu.addItem(statusItem)
        menu.addItem(.separator())
        add(chrome.dashboard, symbol: "macwindow", action: #selector(open), to: menu)
        add(chrome.newChat, symbol: "square.and.pencil", action: #selector(createChat), to: menu)
        menu.addItem(.separator())
        add(chrome.settings, symbol: "gearshape", action: #selector(settings), key: ",", to: menu)
        add(chrome.setup, symbol: "checkmark.shield", action: #selector(setup), to: menu)
        add(chrome.feedback, symbol: "bubble.left", action: #selector(feedback), to: menu)
        add(chrome.about, symbol: "info.circle", action: #selector(about), to: menu)
        menu.addItem(.separator())
        add(chrome.help, symbol: "questionmark.circle", action: #selector(help), to: menu)
        menu.addItem(.separator())
        voiceItem.target = self
        menu.addItem(voiceItem)
        wakeWordItem.target = self
        menu.addItem(wakeWordItem)
        add(chrome.restart, symbol: "arrow.clockwise", action: #selector(restart), key: "r", to: menu)
        add(chrome.quit, symbol: "power", action: #selector(quit), key: "q", to: menu)
        shortcutMenu.removeAllItems()
        for choice in PushToTalkShortcutChoice.allCases {
            let entry = NSMenuItem(title: choice.title, action: #selector(changeShortcut(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = choice.rawValue
            shortcutMenu.addItem(entry)
        }
        _ = buildSpeechSpeedMenu()
        addCursorSettings(to: NSMenu())
        item.menu = menu
        updateStatus(workspace: workspaceStatus, voiceEnabled: voiceEnabled, voiceAvailable: voiceAvailable, recording: recording)
    }

    private func add(_ title: String, symbol: String, action: Selector, key: String = "", to menu: NSMenu) {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
        entry.target = self
        entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        menu.addItem(entry)
    }

    private func statusDot(connected: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
            (connected ? NSColor.systemGreen : NSColor.secondaryLabelColor).setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2)).fill()
            return true
        }
        return image
    }

    @objc private func createChat() { newChat?() }
    @objc private func feedback() { giveFeedback?() }
    @objc private func help() { showHelp?() }
    @objc private func restart() { restartApp?() }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildImportItem() -> NSMenuItem {
        let importItem = NSMenuItem()
        let drop = ImportDropView(title: ImportCopy(english: copy.language == .english).dropHint)
        drop.openImport = { [weak self] in self?.openImport?() }
        drop.receive = { [weak self] in self?.importDocuments?($0) ?? false }
        importItem.view = drop
        return importItem
    }

    private func buildSpeechSpeedMenu() -> NSMenuItem {
        let speedTitle = copy.language == .german ? VoiceCopy.speedMenuTitle : VoiceCopy.speedMenuTitleEnglish
        let speechSettings = NSMenuItem(title: speedTitle, action: nil, keyEquivalent: "")
        speechSettings.submenu = speechSpeedMenu
        speechSpeedMenu.title = speedTitle
        speechSpeedMenu.removeAllItems()
        let savedSpeed = preferences.object(forKey: VoiceConfiguration.speedPreferenceKey) as? Double ?? 1
        for speed in VoiceConfiguration.speedChoices {
            let entry = NSMenuItem(title: VoiceCopy.speedTitle(speed), action: #selector(changeSpeechSpeed(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = speed
            entry.state = savedSpeed == speed ? .on : .off
            speechSpeedMenu.addItem(entry)
        }
        return speechSettings
    }

    @objc private func open() { openWorkspace?() }
    @objc private func settings() { openSettings?() }
    @objc private func setup() {
        if let openSetup { openSetup() } else { checkSetup?() }
    }
    @objc private func relatives() { openRelatives?() }
    @objc private func overlay() { toggleOverlay?() }
    @objc private func circle() { circleToAsk?() }
    @objc private func cancelDrawing() { cancelCircle?() }
    @objc private func voice() { enableVoice?() }
    @objc private func updates() { checkForUpdates?() }

    @objc private func changeSpeechSpeed(_ sender: NSMenuItem) {
        guard let speed = sender.representedObject as? Double, VoiceConfiguration.speedChoices.contains(speed) else { return }
        preferences.set(speed, forKey: VoiceConfiguration.speedPreferenceKey)
        for entry in speechSpeedMenu.items { entry.state = entry === sender ? .on : .off }
        speechSpeedChanged?(speed)
    }

    @objc private func changeShortcut(_ sender: NSMenuItem) {
        guard let rawValue = sender.representedObject as? String,
            let choice = PushToTalkShortcutChoice(rawValue: rawValue)
        else { return }
        selectShortcut(choice)
    }

    public func selectShortcut(_ choice: PushToTalkShortcutChoice) {
        shortcutChoice = choice
        choice.save(to: preferences)
        updateShortcutItems()
        shortcutChanged?(choice)
    }

    private func updateShortcutItems() {
        let chrome = ChromeCopy(language: copy.language)
        voiceItem.title = voiceEnabled ? chrome.pause : chrome.resume
        voiceItem.image = NSImage(systemSymbolName: voiceEnabled ? "pause" : "play", accessibilityDescription: nil)
        for entry in shortcutMenu.items {
            entry.state = (entry.representedObject as? String) == shortcutChoice.rawValue ? .on : .off
        }
    }

    private func addCursorSettings(to menu: NSMenu) {
        let size = NSMenuItem(title: OverlayCopy.sizeTitle, action: nil, keyEquivalent: "")
        size.submenu = cursorSizeMenu
        cursorSizeMenu.removeAllItems()
        for choice in CursorSize.allCases {
            let entry = NSMenuItem(title: OverlayCopy.sizes[choice] ?? choice.rawValue,
                                   action: #selector(changeCursorSize(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = choice.rawValue
            cursorSizeMenu.addItem(entry)
        }
        let speed = NSMenuItem(title: OverlayCopy.speedTitle, action: nil, keyEquivalent: "")
        speed.submenu = cursorSpeedMenu
        cursorSpeedMenu.removeAllItems()
        for choice in CursorSpeed.allCases {
            let entry = NSMenuItem(title: OverlayCopy.speeds[choice] ?? choice.rawValue,
                                   action: #selector(changeCursorSpeed(_:)), keyEquivalent: "")
            entry.target = self
            entry.representedObject = choice.rawValue
            cursorSpeedMenu.addItem(entry)
        }
        reducedMotionItem.target = self
        menu.addItem(size)
        menu.addItem(speed)
        reducedMotionItem.menu?.removeItem(reducedMotionItem)
        menu.addItem(reducedMotionItem)
        updateCursorItems()
    }

    @objc private func changeCursorSize(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let choice = CursorSize(rawValue: raw) else { return }
        preferences.set(choice.rawValue, forKey: OverlayPreferenceKey.cursorSize)
        updateCursorItems()
    }

    @objc private func changeCursorSpeed(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let choice = CursorSpeed(rawValue: raw) else { return }
        preferences.set(choice.rawValue, forKey: OverlayPreferenceKey.cursorSpeed)
        updateCursorItems()
    }

    @objc private func changeMotion() {
        preferences.set(preferences.bool(forKey: OverlayPreferenceKey.reducedMotion) == false,
                        forKey: OverlayPreferenceKey.reducedMotion)
        updateCursorItems()
    }

    private func updateCursorItems() {
        let size = preferences.string(forKey: OverlayPreferenceKey.cursorSize).flatMap(CursorSize.init(rawValue:)) ?? .standard
        let speed = preferences.string(forKey: OverlayPreferenceKey.cursorSpeed).flatMap(CursorSpeed.init(rawValue:)) ?? .standard
        for entry in cursorSizeMenu.items {
            entry.state = (entry.representedObject as? String) == size.rawValue ? .on : .off
        }
        for entry in cursorSpeedMenu.items {
            entry.state = (entry.representedObject as? String) == speed.rawValue ? .on : .off
        }
        reducedMotionItem.state = preferences.bool(forKey: OverlayPreferenceKey.reducedMotion) ? .on : .off
    }

    @objc private func changeConsent() {
        let optedIn = analyticsItem.state != .on
        analyticsItem.state = optedIn ? .on : .off
        preferences.set(optedIn, forKey: "analyticsOptedIn")
        analyticsConsentChanged?(optedIn)
    }
}
