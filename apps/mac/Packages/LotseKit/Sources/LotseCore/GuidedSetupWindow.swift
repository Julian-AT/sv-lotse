import AppKit
import LotseBridge
import SwiftUI

@MainActor
final class GuidedSetupWindow: NSWindowController, NSWindowDelegate {
    private let model: GuidedSetupModel
    var openWorkspace: (() -> Void)?

    convenience init(
        _ settings: CompanionSettingsModel, workspace: WorkspaceWindowController,
        menu: MenuBarController, settingsWindow: CompanionSettingsWindow
    ) {
        self.init(model: GuidedSetupModel(settings: settings, connection: SystemGuidedSetupConnection(workspace: workspace)))
        menu.openSetup = { [weak self] in self?.showSetup(requestPermissions: true) }
        settingsWindow.openSetup = { [weak self] in self?.showSetup(requestPermissions: true) }
        openWorkspace = { [weak workspace] in workspace?.showWorkspace() }
    }

    init(model: GuidedSetupModel) {
        self.model = model
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 860, height: 740),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
        )
        window.title = model.settings.copy.appName
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 820, height: 720)
        window.center()
        super.init(window: window)
        window.delegate = self
        window.contentView = NSHostingView(rootView: GuidedSetupView(model: model) { [weak self] in
            guard let self else { return }
            self.model.stop()
            self.model.settings.stopSample()
            self.window?.orderOut(nil)
            openWorkspace?()
        })
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    /// "Einrichtung prüfen" asks again for anything still missing; the first launch asks for everything once.
    func showSetup(requestPermissions force: Bool = false) {
        model.start()
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        model.requestMissingPermissions(force: force)
    }

    func start() {
        if model.completed { openWorkspace?() } else { showSetup() }
    }

    func stop() {
        model.stop()
        model.settings.stopSample()
    }

    func windowWillClose(_ notification: Notification) {
        model.stop()
        model.settings.stopSample()
    }
}
