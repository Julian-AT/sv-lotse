import AppKit
import SwiftUI

@MainActor
final class CompanionSettingsWindow: NSWindowController, NSWindowDelegate {
    private let model: CompanionSettingsModel
    private var permissionMonitor: Task<Void, Never>?
    var openWorkspace: (() -> Void)?
    var openSetup: (() -> Void)?

    init(model: CompanionSettingsModel) {
        self.model = model
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 700, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
        )
        window.title = model.copy.appName
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 620, height: 600)
        window.center()
        super.init(window: window)
        window.delegate = self
        window.contentView = NSHostingView(rootView: CompanionSettingsView(model: model, openSetup: { [weak self] in
            self?.openSetup?()
        }, openWorkspace: { [weak self] in
            self?.permissionMonitor?.cancel()
            self?.window?.orderOut(nil)
            self?.openWorkspace?()
        }))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func showSettings() {
        permissionMonitor?.cancel()
        permissionMonitor = Task { @MainActor [weak self] in
            while Task.isCancelled == false {
                guard let self else { return }
                await model.refreshLivePermissions()
                do { try await Task.sleep(for: CompanionConfiguration.setupRecheckInterval) } catch { return }
            }
        }
        model.refreshPermissions()
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        permissionMonitor?.cancel()
        permissionMonitor = nil
        model.stopSample()
    }
}
