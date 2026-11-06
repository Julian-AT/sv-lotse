import AppKit
import ApplicationServices
import LotseProtocol
import LotseResolver

/// Pilot-driven navigation on the page Lotse opened: the cursor flies to a link, tab or accordion,
/// highlights it, presses it through Accessibility and waits for the next page. Allow and deny
/// rules are decided here, natively; the brain cannot widen them.
extension BrowserPageCapability {
    /// Clicks per rolling window, independent of the brain's per-turn cap.
    static let maximumClicks = 5
    static let clickWindow: TimeInterval = 90
    static let highlightBeforeClick: Duration = .milliseconds(650)

    struct Step: Sendable {
        let rect: CGRect
        let label: String
    }

    struct ClickTarget: @unchecked Sendable {
        let node: LiveAXNode
        let rect: CGRect
        let decision: BrowserClickDecision
        let page: String
        var scrolled = false
    }

    /// One navigation step from a `ui.click` tool invocation.
    func click(_ invocation: ToolInvocation, present: @MainActor (Step) -> Void) async -> ActionResult {
        let id = invocation.toolCallID
        let generation = navigationGeneration
        guard case .unionMap(let target)? = invocation.input["target"], case .string(let handle)? = target["handle"],
            case .string(let url)? = target["url"]
        else { return Self.result(id, false, "INVALID_TOOL_INPUT") }
        guard AXIsProcessTrusted(), let (pid, _) = currentBrowser() else { return Self.result(id, false, "BROWSER_UNAVAILABLE") }
        guard allows(url) else { return Self.result(id, false, "origin-not-allowed") }
        let now = Date()
        clickTimes = clickTimes.filter { now.timeIntervalSince($0) < Self.clickWindow }
        guard clickTimes.count < Self.maximumClicks else { return Self.result(id, false, "click-limit") }
        let policy = policy
        let top = Self.primaryTop
        let expected = active?.url.absoluteString
        let preferred = active?.area
        let label = labels[handle]
        let found = await Task.detached { () -> ClickTarget? in
            guard let area = Self.pageArea(pid: pid, top: top, policy: policy, expected: expected, preferred: preferred), let current = area.url,
                BrowserPageSafety.isLoginPage(current) == false, let page = area.frame,
                let element = BrowserPageReader.element(handle: handle, label: label, in: BrowserPageReader.elements(in: area))
            else { return nil }
            let decision = BrowserPageSafety.clickDecision(role: element.role, subrole: element.node.subrole, label: element.label,
                url: element.node.url, expanded: element.node.expanded, secure: BrowserPageReader.isSecure(element.node)) {
                policy?.allows($0) == true
            }
            guard let rect = Self.scrolledIntoView(element.node, page: page) else { return nil }
            return ClickTarget(node: element.node, rect: rect, decision: decision, page: current)
        }.value
        guard let found else { return Self.result(id, false, "target_unavailable") }
        let (node, rect, decision, current) = (found.node, found.rect, found.decision, found.page)
        if case .denied(let reason) = decision {
            log.info("browser click denied: \(reason, privacy: .public)")
            return Self.result(id, false, "click-denied:\(reason)")
        }
        NSRunningApplication(processIdentifier: pid)?.activate()
        present(Step(rect: rect, label: label ?? ""))
        try? await Task.sleep(for: Self.highlightBeforeClick)
        guard generation == navigationGeneration, Task.isCancelled == false else { return Self.result(id, false, "USER_STOPPED") }
        clickTimes.append(Date())
        let pressed = await Task.detached { node.perform(kAXPressAction) }.value
        guard pressed else { return Self.result(id, false, "press-failed") }
        log.info("browser click pressed (\(String(describing: decision), privacy: .public))")
        guard case .navigate(let destination) = decision, BrowserPageSafety.sameDocument(destination, current) == false else {
            try? await Task.sleep(for: .milliseconds(450))
            return ActionResult(actionID: id, confidence: 1, failureReason: nil, resolvedBy: .ax, success: true)
        }
        return await awaitNavigation(id: id, pid: pid, destination: destination, previous: current, generation: generation)
    }

    /// The next page: the link's exact page first; after a grace period any allowlisted page of the
    /// focused window that differs from the previous one (redirects).
    func awaitNavigation(id: String, pid: pid_t, destination: String, previous: String, generation: Int) async -> ActionResult {
        let policy = policy
        let top = Self.primaryTop
        let started = ContinuousClock.now
        var landed: LiveAXNode?
        let ready = await Self.awaitReady(timeout: readyTimeout) {
            guard generation == navigationGeneration else { return "" }
            let exactOnly = started.duration(to: .now) < .seconds(3)
            let area = await Task.detached { () -> LiveAXNode? in
                let area = BrowserAccessibility.webArea(pid: pid, primaryTop: top, focusedOnly: true, where: {
                    $0.url.map { BrowserPageSafety.sameDocument($0, destination) } ?? false
                }) ?? (exactOnly ? nil : BrowserAccessibility.webArea(pid: pid, primaryTop: top, focusedOnly: true) {
                    $0.url.map { policy?.allows($0) == true && BrowserPageSafety.sameDocument($0, previous) == false } ?? false
                })
                guard let area, area.url != nil, area.children.isEmpty == false else { return nil }
                return area
            }.value
            landed = area
            return area?.url
        }
        guard let ready, ready.isEmpty == false, let url = URL(string: ready) else {
            return Self.result(id, false, ready == "" ? "USER_STOPPED" : "load-timeout")
        }
        if let current = active { active = ActivePage(bundleID: current.bundleID, pid: current.pid, url: url, area: landed) }
        log.info("browser navigated via AX to \(url.path, privacy: .public)")
        return ActionResult(actionID: id, confidence: BrowserPageSafety.sameDocument(ready, destination) ? 1 : 0.8,
            failureReason: nil, resolvedBy: .ax, success: true)
    }

    /// One scroll step: an element into view, or about a screen further down or up the page.
    func scroll(_ invocation: ToolInvocation, present: @MainActor (Step) -> Void) async -> ActionResult {
        let id = invocation.toolCallID
        guard AXIsProcessTrusted(), let (pid, _) = currentBrowser() else { return Self.result(id, false, "BROWSER_UNAVAILABLE") }
        var handle: String?
        if case .unionMap(let target)? = invocation.input["target"], case .string(let value)? = target["handle"] { handle = value }
        let up = invocation.input["direction"] == .string("up")
        let policy = policy
        let top = Self.primaryTop
        let expected = active?.url.absoluteString
        let preferred = active?.area
        let label = handle.flatMap { labels[$0] }
        let page = await Task.detached { () -> CGRect? in
            Self.pageArea(pid: pid, top: top, policy: policy, expected: expected, preferred: preferred)?.frame
        }.value
        guard let page else { return Self.result(id, false, "target_unavailable") }
        NSRunningApplication(processIdentifier: pid)?.activate()
        present(Step(rect: CGRect(x: page.midX - 20, y: up ? page.maxY - 140 : page.minY + 100, width: 40, height: 40),
            label: up ? "↑" : "↓"))
        let rect = await Task.detached { () -> CGRect? in
            guard let area = Self.pageArea(pid: pid, top: top, policy: policy, expected: expected, preferred: preferred), let frame = area.frame else { return nil }
            let elements = BrowserPageReader.elements(in: area)
            let node: LiveAXNode?
            if let handle {
                node = BrowserPageReader.element(handle: handle, label: label, in: elements)?.node
            } else {
                node = Self.scrollTarget(elements.map { ($0.node, $0.frame) }, page: frame, up: up)
            }
            guard let node else { return nil }
            node.perform("AXScrollToVisible")
            usleep(350_000)
            return node.refreshedFrame()
        }.value
        guard let rect else { return Self.result(id, false, "nothing-to-scroll") }
        present(Step(rect: rect, label: label ?? ""))
        log.info("browser scrolled \(up ? "up" : "down", privacy: .public) via AX")
        return ActionResult(actionID: id, confidence: 1, failureReason: nil, resolvedBy: .ax, success: true)
    }

    /// The element about one screen below (or above) the visible page area, in AppKit coordinates.
    nonisolated static func scrollTarget<Node>(_ elements: [(Node, CGRect)], page: CGRect, up: Bool) -> Node? {
        let goal = up ? page.maxY + page.height * 0.8 : page.minY - page.height * 0.8
        let outside = elements.filter { up ? $0.1.minY > page.maxY : $0.1.maxY < page.minY }
        return outside.min { abs($0.1.midY - goal) < abs($1.1.midY - goal) }?.0
    }

    /// The page's main heading right after it opened, so the cursor shows the page at once.
    func firstLook() async -> Step? {
        guard AXIsProcessTrusted(), let (pid, _) = currentBrowser() else { return nil }
        let policy = policy
        let top = Self.primaryTop
        let expected = active?.url.absoluteString
        let preferred = active?.area
        return await Task.detached { () -> Step? in
            guard let area = Self.pageArea(pid: pid, top: top, policy: policy, expected: expected, preferred: preferred), let page = area.frame else { return nil }
            let heading = BrowserPageReader.elements(in: area, limit: 1500).first {
                $0.role == "heading" && page.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY))
            }
            return heading.map { Step(rect: $0.frame, label: $0.label) }
        }.value
    }

    /// ⌥⌘ / stop: the running step ends before its press, and waiting for a page stops.
    func cancelNavigation() { navigationGeneration += 1 }
}
