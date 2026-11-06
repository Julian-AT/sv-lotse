#if DEBUG
import AppKit
import Carbon.HIToolbox
import LotseOverlay
import LotseProtocol
import LotseResolver

/// Debug builds only: `-LotseTourProbe <url>[,<url>]` (and optionally `-LotseTourPace fast`) opens
/// each allowlisted page in the default browser, runs the same tour as the companion (silent,
/// captions only), closes the tab it opened and quits. Lets the tour be checked on a real page without driving the chat.
@MainActor
public enum BrowserTourProbe {
    public static func runIfRequested() -> Bool {
        guard let list = UserDefaults.standard.string(forKey: "LotseTourProbe"), list.isEmpty == false else { return false }
        NSApp.setActivationPolicy(.accessory)
        let overlay = OverlayWindowManager()
        let page = BrowserPageCapability()
        overlay.showOverlay()
        Task { @MainActor in
            for (index, address) in list.split(separator: ",").map(String.init).enumerated() {
                let action = Action.openResource(.init(id: "probe-\(index)", kind: .openResource, payload: .init(label: nil, style: nil),
                    sentenceIndex: 0, target: .dom(.init(handle: "page", kind: .dom, url: address))))
                let result = await page.open(action)
                page.log.info("probe open \(address, privacy: .public): \(result.success) \(result.failureReason ?? "", privacy: .public)")
                guard result.success else { continue }
                // Silent: each sentence is held as long as the voice would take to say it.
                let pace = BrowserPageCapability.TourPace(hint: UserDefaults.standard.string(forKey: "LotseTourPace"))
                await page.visibleTour(pace: pace, show: { overlay.state.tour = $0 }, say: { text in
                    Task { try? await Task.sleep(for: .milliseconds(text.count * 65)) }
                })
                try? await Task.sleep(for: .milliseconds(900))
                closeOpenedTab(page)
                try? await Task.sleep(for: .milliseconds(800))
            }
            NSApp.terminate(nil)
        }
        return true
    }

    /// ⌘W in the browser, only while the focused tab still shows the page the probe opened.
    private static func closeOpenedTab(_ page: BrowserPageCapability) {
        guard let active = page.active, NSWorkspace.shared.frontmostApplication?.processIdentifier == active.pid,
            let area = BrowserAccessibility.webArea(pid: active.pid, primaryTop: BrowserPageCapability.primaryTop, focusedOnly: true),
            let url = area.url, BrowserPageSafety.sameDocument(url, active.url.absoluteString)
        else { return }
        for down in [true, false] {
            let key = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_W), keyDown: down)
            key?.flags = .maskCommand
            key?.post(tap: .cghidEventTap)
        }
    }
}
#endif
