import AppKit
import LotseBridge
import LotseOverlay
import SwiftUI
import WebKit

@MainActor
public final class RelativesWindowController: NSWindowController, NSWindowDelegate {
    public let session: SharingSessionController
    private var observers: [NSObjectProtocol] = []

    public init(webView: WKWebView, origin: WorkspaceOrigin, overlay: OverlayState, copy: RelativesCopy = .init()) {
        let client = RelativesTokenClient(webView: webView, origin: origin)
        session = SharingSessionController(client: client, overlay: overlay)
        let window = NSWindow(contentRect: .zero, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = copy.title
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.contentView = NSHostingView(rootView: RelativesSharingView(session: session, client: client, copy: copy))
        window.center()
        super.init(window: window)
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    public func showSharing() {
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        if observers.isEmpty { observeRevocationEvents() }
    }

    public func stop() {
        session.pause()
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observers.removeAll()
    }

    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        session.pause()
        sender.orderOut(nil)
        return false
    }

    private func observeRevocationEvents() {
        // Display geometry changes invalidate normalized pointer mapping; sleep always revokes consent.
        observers.append(NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.session.pause() } })
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification,
                     NSWorkspace.didLaunchApplicationNotification] {
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                // End on application launch so a newly opened sensitive app cannot escape the exclusion list.
                MainActor.assumeIsolated { self?.session.pause() }
            })
        }
    }
}
